import type { EntityManager } from 'typeorm';
import { POSITION_GAP, positionForIndex, reindexedPositions } from './ordering';

/**
 * The `position` reads and writes shared by every orderable table.
 *
 * These take raw table names and a `parentWhere` fragment with positional
 * (`$1`, `$2`) parameters rather than going through a repository, for one
 * reason: both callers run inside someone else's transaction and need the
 * caller's `EntityManager`, and the sibling lock has to be a real
 * `SELECT … FOR UPDATE` on a specific row set.
 *
 * ⚠️ **`parentWhere` must use `IS NOT DISTINCT FROM`, never `=`, for a nullable
 * parent column.** `"folderId" = $2` with `$2` NULL is never true, so every
 * root-level item would compute against zero siblings and stack at
 * `POSITION_GAP`, on top of whatever is already sitting there. This is the
 * single easiest mistake to make in this file and it is invisible until two
 * root-level items exist.
 */

interface PositionRow {
  id: string;
  position: number;
}

/**
 * The position for a new last sibling: `MAX(position) + POSITION_GAP`, or the
 * gap itself when the parent is empty.
 *
 * No lock. Two concurrent creates can read the same MAX and land on the same
 * position, and that is fine — the `position, createdAt, id` ordering resolves
 * a tie deterministically, so the worst case is two items in an arbitrary but
 * *stable* order rather than corruption.
 */
export async function appendPosition(
  manager: EntityManager,
  table: string,
  parentWhere: string,
  params: unknown[],
): Promise<number> {
  const rows = await manager.query<{ max: number | null }[]>(
    `SELECT MAX("position") AS max FROM "${table}" WHERE ${parentWhere}`,
    params,
  );
  const max = rows[0]?.max;
  return max === null || max === undefined
    ? POSITION_GAP
    : Number(max) + POSITION_GAP;
}

/**
 * The position for an item moving to 0-based `index` among its new siblings,
 * renumbering the sibling set first if the gap there is exhausted.
 *
 * Must be called inside a transaction: it takes `FOR UPDATE` on the whole
 * destination sibling set. That lock serializes two moves into the *same*
 * parent while moves into different parents never contend. Its job is to make
 * the intended order win — without it the worst case is still only a shared
 * position, which the ordering tiebreak resolves — so the lock is an
 * optimization, not the thing standing between you and corruption.
 */
export async function positionForMove(
  manager: EntityManager,
  table: string,
  parentWhere: string,
  params: unknown[],
  movingId: string,
  index?: number,
): Promise<number> {
  // Excluding the moving row matters: left in, it would be its own neighbour
  // and the "midpoint" would be the position it already has.
  const select = `SELECT "id", "position" FROM "${table}" WHERE ${parentWhere} AND "id" <> $${params.length + 1} ORDER BY "position", "createdAt", "id" FOR UPDATE`;
  const lockParams = [...params, movingId];

  const siblings = await manager.query<PositionRow[]>(select, lockParams);

  const position = positionForIndex(siblings, index);
  if (position !== 'reindex') return position;

  // Nowhere left to split. Renumber this one sibling set onto clean multiples
  // of the gap and ask again — sibling sets are tens of rows, and this is the
  // only path that ever rewrites one.
  const renumbered = reindexedPositions(siblings.length);
  await Promise.all(
    siblings.map((sibling, i) =>
      manager.query(`UPDATE "${table}" SET "position" = $1 WHERE "id" = $2`, [
        renumbered[i],
        sibling.id,
      ]),
    ),
  );

  const retry = positionForIndex(
    siblings.map((sibling, i) => ({ ...sibling, position: renumbered[i] })),
    index,
  );
  /* istanbul ignore next -- a freshly renumbered set always has room. */
  if (retry === 'reindex') {
    throw new Error(
      `Could not find a position in "${table}" even after reindexing`,
    );
  }
  return retry;
}
