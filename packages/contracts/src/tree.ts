import type { HttpMethod } from './request';

/**
 * The whole sidebar in one response: `GET /workspaces/:id/tree`.
 *
 * Eager and entire rather than lazy per collection. The sidebar paints every
 * collection name on first load anyway, so laziness saves no bytes worth
 * having and costs an N+1, a spinner per node, and *more* invalidation work —
 * a request moved between collections would have to invalidate two
 * independently fetched subtrees the client must both know about.
 *
 * What keeps that cheap is that a node is a **skeleton**: a request node
 * carries only what the sidebar draws. No `url`, `headers`, `body` or `auth` —
 * the editor fetches the full row from `GET /requests/:id`. That is ~60-80
 * bytes a request, so a 500-request workspace is around 35 KB.
 */

export interface RequestNode {
  id: string;
  name: string;
  method: HttpMethod;
  folderId: string | null;
  position: number;
}

export interface FolderNode {
  id: string;
  name: string;
  parentFolderId: string | null;
  position: number;
  /** Folders render before requests at every level, as Postman does. */
  folders: FolderNode[];
  requests: RequestNode[];
}

export interface CollectionNode {
  id: string;
  name: string;
  description: string | null;
  position: number;
  folders: FolderNode[];
  requests: RequestNode[];
}

/**
 * ⚠️ A **single resource**, not a list — so it has no `{ data, meta }`
 * envelope, exactly like `GET /auth/me`. The "lists are paginated" rule exists
 * so a bare array can grow a cursor without breaking clients; half a tree is
 * not a tree, and no page boundary makes sense across a nesting level. The
 * escape hatch for an enormous workspace is lazy *sub*trees, not a cursor over
 * this. `GET /workspaces` is a real list and does return `Paginated<Workspace>`.
 */
export interface WorkspaceTree {
  workspaceId: string;
  collections: CollectionNode[];
}
