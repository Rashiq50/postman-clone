import { Logger } from '@nestjs/common';
import type {
  CollectionNode,
  FolderNode,
  RequestNode,
  WorkspaceTree,
} from '@raven/contracts';

/** The three flat result sets `TreeService` reads, before nesting. */
export interface FlatCollection {
  id: string;
  name: string;
  description: string | null;
  position: number;
  createdAt: Date | string;
}

export interface FlatFolder {
  id: string;
  collectionId: string;
  parentFolderId: string | null;
  name: string;
  position: number;
  createdAt: Date | string;
}

export interface FlatRequest {
  id: string;
  collectionId: string;
  folderId: string | null;
  name: string;
  method: RequestNode['method'];
  position: number;
  createdAt: Date | string;
}

const logger = new Logger('buildTree');

/**
 * Sorts by `position`, then `createdAt`, then `id`.
 *
 * The trailing keys are the safety net that makes the whole sparse-position
 * scheme safe: two rows that end up sharing a position still render in a
 * stable order rather than swapping places between refetches.
 */
function byPosition<
  T extends { position: number; createdAt: Date | string; id: string },
>(a: T, b: T): number {
  if (a.position !== b.position) return a.position - b.position;
  const at = new Date(a.createdAt).getTime();
  const bt = new Date(b.createdAt).getTime();
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Nests three flat result sets into the sidebar tree.
 *
 * A pure function rather than a recursive CTE, for two reasons: the assembly is
 * then testable without a database, and three indexed flat `SELECT`s are a
 * cheaper and far more predictable plan than one recursive query.
 *
 * ⚠️ An **orphan** — a folder or request whose parent id is not in the set —
 * is attached to the collection root and logged, never dropped. The composite
 * foreign keys make orphans unreachable in practice, but if one ever did occur,
 * silently discarding it produces a subtree that has vanished from the UI with
 * nothing anywhere to explain why. Surfacing it at the root is ugly and
 * diagnosable; dropping it is invisible and not.
 */
export function buildTree(
  workspaceId: string,
  collections: readonly FlatCollection[],
  folders: readonly FlatFolder[],
  requests: readonly FlatRequest[],
): WorkspaceTree {
  const folderNodes = new Map<string, FolderNode>();
  for (const folder of folders) {
    folderNodes.set(folder.id, {
      id: folder.id,
      name: folder.name,
      parentFolderId: folder.parentFolderId,
      position: folder.position,
      folders: [],
      requests: [],
    });
  }

  const collectionNodes = new Map<string, CollectionNode>();
  const roots: CollectionNode[] = [];
  for (const collection of [...collections].sort(byPosition)) {
    const node: CollectionNode = {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      position: collection.position,
      folders: [],
      requests: [],
    };
    collectionNodes.set(collection.id, node);
    roots.push(node);
  }

  // Sorted before nesting, so every children array comes out ordered without a
  // second pass over the tree.
  for (const folder of [...folders].sort(byPosition)) {
    const node = folderNodes.get(folder.id);
    const collection = collectionNodes.get(folder.collectionId);
    if (!node || !collection) continue;

    if (folder.parentFolderId === null) {
      collection.folders.push(node);
      continue;
    }

    const parent = folderNodes.get(folder.parentFolderId);
    if (parent) {
      parent.folders.push(node);
    } else {
      logger.warn(
        `Folder ${folder.id} references missing parent ${folder.parentFolderId}; attaching to collection root`,
      );
      node.parentFolderId = null;
      collection.folders.push(node);
    }
  }

  for (const request of [...requests].sort(byPosition)) {
    const collection = collectionNodes.get(request.collectionId);
    if (!collection) continue;

    const node: RequestNode = {
      id: request.id,
      name: request.name,
      method: request.method,
      folderId: request.folderId,
      position: request.position,
    };

    if (request.folderId === null) {
      collection.requests.push(node);
      continue;
    }

    const parent = folderNodes.get(request.folderId);
    if (parent) {
      parent.requests.push(node);
    } else {
      logger.warn(
        `Request ${request.id} references missing folder ${request.folderId}; attaching to collection root`,
      );
      node.folderId = null;
      collection.requests.push(node);
    }
  }

  return { workspaceId, collections: roots };
}
