/**
 * Collections and the folders inside them.
 *
 * One file because the boundary follows the aggregate, not the table: a
 * `Folder` is meaningless without the `Collection` it lives in, and every
 * consumer that reads one reads the other.
 */

export const COLLECTION_NAME_MAX_LENGTH = 200;

export interface Collection {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  /**
   * Sparse ordering key, gaps of 1024. Clients render by it but never compute
   * one: the move endpoints take a 0-based `index` among siblings instead.
   */
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCollectionInput {
  workspaceId: string;
  name: string;
  description?: string | null;
}

export interface UpdateCollectionInput {
  name?: string;
  description?: string | null;
}

export interface MoveCollectionInput {
  index: number;
}

export interface Folder {
  id: string;
  collectionId: string;
  /** NULL means the folder sits at the collection root. */
  parentFolderId: string | null;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFolderInput {
  collectionId: string;
  parentFolderId?: string | null;
  name: string;
}

export interface UpdateFolderInput {
  name?: string;
}

/**
 * A folder never changes collection — the composite foreign key in the schema
 * makes a cross-collection parent unrepresentable — so there is no
 * `collectionId` here. `index` is the 0-based slot among the destination's
 * children; omitted means append.
 */
export interface MoveFolderInput {
  parentFolderId: string | null;
  index?: number;
}
