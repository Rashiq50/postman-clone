/**
 * Seeds a workspace with a large sidebar tree so the frontend can be tested at
 * scale (see TREE_SCALE_PLAN.md). Writes straight to Postgres — the HTTP API
 * would be ~20k sequential round trips; this is a handful of bulk INSERTs.
 *
 * Usage (from backend/):
 *   node scripts/seed-tree.mjs <workspaceId>
 *   node scripts/seed-tree.mjs <workspaceId> --collections=500 --depth=5
 *   node scripts/seed-tree.mjs <workspaceId> --clean       # remove seeded rows
 *
 * Shape per collection: a "spine" of nested folders `depth` levels deep, with
 * a second (leaf) folder at every level, 3 requests in every folder and 3 at
 * the collection root. Defaults: 500 collections × depth 5 → 500 collections,
 * 5,000 folders, 16,500 requests (~22k nodes).
 *
 * Every seeded collection is named "Seed NNNN …" — `--clean` deletes by that
 * prefix and everything under it follows via ON DELETE CASCADE.
 *
 * Positions are multiples of 1024 (POSITION_GAP), appended after the current
 * MAX so existing rows keep their place. Rows are plain INSERTs; jsonb columns
 * take their database defaults.
 */
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const GAP = 1024;
const SEED_PREFIX = 'Seed ';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const [workspaceId, ...rest] = process.argv.slice(2);
const flags = new Map(
  rest.map((arg) => {
    const [k, v] = arg.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);

if (!workspaceId || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
  console.error('Usage: node scripts/seed-tree.mjs <workspaceId> [--collections=500] [--depth=5] [--clean]');
  process.exit(1);
}

const COLLECTIONS = Number(flags.get('collections') ?? 500);
const DEPTH = Number(flags.get('depth') ?? 5);
const REQUESTS_PER_FOLDER = 3;

const client = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME,
});

/** Multi-row INSERT in chunks, to stay well under pg's 65535-parameter cap. */
async function bulkInsert(table, columns, rows) {
  const chunkSize = Math.floor(30000 / columns.length);
  for (let at = 0; at < rows.length; at += chunkSize) {
    const chunk = rows.slice(at, at + chunkSize);
    const placeholders = chunk
      .map((row, r) => `(${row.map((_, c) => `$${r * columns.length + c + 1}`).join(', ')})`)
      .join(', ');
    await client.query(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${placeholders}`,
      chunk.flat(),
    );
  }
}

async function main() {
  await client.connect();

  const ws = await client.query('SELECT "id", "name" FROM "workspaces" WHERE "id" = $1', [workspaceId]);
  if (ws.rowCount === 0) {
    throw new Error(`Workspace ${workspaceId} does not exist.`);
  }

  if (flags.has('clean')) {
    const res = await client.query(
      `DELETE FROM "collections" WHERE "workspaceId" = $1 AND "name" LIKE $2`,
      [workspaceId, `${SEED_PREFIX}%`],
    );
    console.log(`Removed ${res.rowCount} seeded collections (folders/requests cascaded) from "${ws.rows[0].name}".`);
    return;
  }

  const maxRes = await client.query(
    'SELECT COALESCE(MAX("position"), 0) AS max FROM "collections" WHERE "workspaceId" = $1',
    [workspaceId],
  );
  let collectionPos = Number(maxRes.rows[0].max);

  const collections = [];
  const folders = [];
  const requests = [];

  const addRequests = (collectionId, folderId, label) => {
    for (let r = 0; r < REQUESTS_PER_FOLDER; r += 1) {
      requests.push([
        randomUUID(),
        collectionId,
        folderId,
        `${label} req ${r + 1}`,
        METHODS[(requests.length + r) % METHODS.length],
        `https://api.example.com/${label.toLowerCase().replaceAll(' ', '-')}/${r + 1}`,
        (r + 1) * GAP,
      ]);
    }
  };

  for (let c = 0; c < COLLECTIONS; c += 1) {
    const collectionId = randomUUID();
    collectionPos += GAP;
    collections.push([
      collectionId,
      workspaceId,
      `${SEED_PREFIX}${String(c + 1).padStart(4, '0')} collection`,
      collectionPos,
    ]);

    addRequests(collectionId, null, `c${c + 1} root`);

    let parentFolderId = null;
    for (let d = 0; d < DEPTH; d += 1) {
      const spineId = randomUUID();
      const leafId = randomUUID();
      folders.push([spineId, collectionId, parentFolderId, `Level ${d + 1} spine`, GAP]);
      folders.push([leafId, collectionId, parentFolderId, `Level ${d + 1} leaf`, GAP * 2]);
      addRequests(collectionId, spineId, `c${c + 1} d${d + 1} spine`);
      addRequests(collectionId, leafId, `c${c + 1} d${d + 1} leaf`);
      parentFolderId = spineId;
    }
  }

  console.log(
    `Seeding "${ws.rows[0].name}": ${collections.length} collections, ${folders.length} folders, ${requests.length} requests…`,
  );

  const started = Date.now();
  await client.query('BEGIN');
  try {
    await bulkInsert('collections', ['id', 'workspaceId', 'name', 'position'], collections);
    // Parents before children: sort by depth via array order — spines are
    // pushed before the folders that reference them, so insertion order is
    // already parent-first and the composite FK is satisfied.
    await bulkInsert('folders', ['id', 'collectionId', 'parentFolderId', 'name', 'position'], folders);
    await bulkInsert('requests', ['id', 'collectionId', 'folderId', 'name', 'method', 'url', 'position'], requests);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s. Undo with: node scripts/seed-tree.mjs ${workspaceId} --clean`);
}

main()
  .catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
