/**
 * Sparse ordering: `position integer`, gaps of 1024, reindex on demand.
 *
 * A new sibling gets `MAX(position) + POSITION_GAP`; an item moved to index *i*
 * gets the midpoint of its new neighbours. When the neighbours are adjacent
 * there is nowhere left to split, and the caller renumbers that one sibling set
 * and retries.
 *
 * 1024 rather than 1000 because binary halving between two integers 1024 apart
 * yields exactly ten clean levels — the exhaustion point is an exact, testable
 * number rather than a rounding accident.
 *
 * Floats were the obvious alternative and were rejected twice over: they are
 * miserable to debug (`0.30000000000000004`) and their exhaustion is silent
 * rather than detectable. A contiguous 0,1,2,… reindex was rejected because it
 * rewrites the whole sibling set on every *create*, which makes an optimistic
 * insert impossible to express.
 */
export const POSITION_GAP = 1024;

/**
 * The `position` for an item landing at `index` among `siblings`.
 *
 * `siblings` must be sorted ascending and must **exclude the item being
 * moved** — otherwise it is its own neighbour and the midpoint is its current
 * position. `index` is 0-based and clamped; omitting it means append.
 *
 * Returns `'reindex'` when the two neighbours are adjacent (`after - before <
 * 2`), leaving no integer between them. The caller renumbers that sibling set
 * to 1024, 2048, … and calls again.
 */
export function positionForIndex(
  siblings: readonly { position: number }[],
  index?: number,
): number | 'reindex' {
  if (siblings.length === 0) return POSITION_GAP;

  // Append: past the end, or no index given at all.
  const target = index ?? siblings.length;
  if (target >= siblings.length) {
    return siblings[siblings.length - 1].position + POSITION_GAP;
  }

  // Prepend. A negative result is legal — `position` is a plain signed integer
  // and nothing anywhere assumes it is positive. Halving downwards means
  // repeated prepends never need a reindex until the gap itself runs out.
  const clamped = Math.max(0, target);
  if (clamped === 0) {
    const first = siblings[0].position;
    return first - POSITION_GAP;
  }

  // Between two existing siblings.
  const before = siblings[clamped - 1].position;
  const after = siblings[clamped].position;
  if (after - before < 2) return 'reindex';
  return Math.floor((before + after) / 2);
}

/**
 * The positions a sibling set takes after a reindex: 1024, 2048, 3072, …
 * Sibling sets are tens of rows, so rewriting one is cheap; it is only ever
 * done on the `'reindex'` path.
 */
export function reindexedPositions(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * POSITION_GAP);
}

/**
 * The ordering every query uses. The trailing keys are the safety net: two rows
 * that somehow share a position still render deterministically instead of
 * flickering between refetches, which is what makes the sibling lock in the
 * move path an optimization rather than a correctness requirement.
 */
export const ORDER_BY_POSITION = '"position", "createdAt", "id"';
