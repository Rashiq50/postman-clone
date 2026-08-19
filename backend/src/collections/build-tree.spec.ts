import { Logger } from '@nestjs/common';
import {
  buildTree,
  type FlatCollection,
  type FlatFolder,
  type FlatRequest,
} from './build-tree';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

const collection = (
  id: string,
  position: number,
  extra: Partial<FlatCollection> = {},
): FlatCollection => ({
  id,
  name: id,
  description: null,
  position,
  createdAt: EPOCH,
  ...extra,
});

const folder = (
  id: string,
  collectionId: string,
  parentFolderId: string | null,
  position: number,
  extra: Partial<FlatFolder> = {},
): FlatFolder => ({
  id,
  collectionId,
  parentFolderId,
  name: id,
  position,
  createdAt: EPOCH,
  ...extra,
});

const request = (
  id: string,
  collectionId: string,
  folderId: string | null,
  position: number,
  extra: Partial<FlatRequest> = {},
): FlatRequest => ({
  id,
  collectionId,
  folderId,
  name: id,
  method: 'GET',
  position,
  createdAt: EPOCH,
  ...extra,
});

describe('buildTree', () => {
  it('returns an empty tree for a workspace with no collections', () => {
    expect(buildTree('ws-1', [], [], [])).toEqual({
      workspaceId: 'ws-1',
      collections: [],
    });
  });

  it('nests folders and requests under their parents at every level', () => {
    const tree = buildTree(
      'ws-1',
      [collection('c1', 1024)],
      [folder('f1', 'c1', null, 1024), folder('f2', 'c1', 'f1', 1024)],
      [
        request('r-root', 'c1', null, 1024),
        request('r-f1', 'c1', 'f1', 1024),
        request('r-f2', 'c1', 'f2', 1024),
      ],
    );

    const [c1] = tree.collections;
    expect(c1.requests.map((r) => r.id)).toEqual(['r-root']);
    expect(c1.folders.map((f) => f.id)).toEqual(['f1']);

    const [f1] = c1.folders;
    expect(f1.requests.map((r) => r.id)).toEqual(['r-f1']);
    expect(f1.folders.map((f) => f.id)).toEqual(['f2']);
    expect(f1.folders[0].requests.map((r) => r.id)).toEqual(['r-f2']);
  });

  it('keeps a request node to the sidebar skeleton and nothing more', () => {
    // The whole reason fetching the tree eagerly is affordable.
    const tree = buildTree(
      'ws-1',
      [collection('c1', 1024)],
      [],
      [request('r1', 'c1', null, 1024, { method: 'DELETE' })],
    );

    expect(Object.keys(tree.collections[0].requests[0]).sort()).toEqual(
      ['folderId', 'id', 'method', 'name', 'position'].sort(),
    );
  });

  it('orders collections, folders and requests by position', () => {
    const tree = buildTree(
      'ws-1',
      [collection('c-second', 2048), collection('c-first', 1024)],
      [
        folder('f-second', 'c-first', null, 2048),
        folder('f-first', 'c-first', null, 1024),
      ],
      [
        request('r-second', 'c-first', null, 2048),
        request('r-first', 'c-first', null, 1024),
      ],
    );

    expect(tree.collections.map((c) => c.id)).toEqual(['c-first', 'c-second']);
    expect(tree.collections[0].folders.map((f) => f.id)).toEqual([
      'f-first',
      'f-second',
    ]);
    expect(tree.collections[0].requests.map((r) => r.id)).toEqual([
      'r-first',
      'r-second',
    ]);
  });

  it('breaks a position tie by createdAt, then by id', () => {
    // The safety net that makes a shared position a cosmetic problem rather
    // than a flickering-order bug across refetches.
    const tree = buildTree(
      'ws-1',
      [collection('c1', 1024)],
      [],
      [
        request('r-c', 'c1', null, 1024, {
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
        request('r-b', 'c1', null, 1024),
        request('r-a', 'c1', null, 1024),
      ],
    );

    expect(tree.collections[0].requests.map((r) => r.id)).toEqual([
      'r-a',
      'r-b',
      'r-c',
    ]);
  });

  it('keeps folders and requests in separate sequences, folders rendered first', () => {
    // Two tables, two independent position sequences — which is what removes
    // the cross-table MAX(), lock and reindex.
    const tree = buildTree(
      'ws-1',
      [collection('c1', 1024)],
      [folder('f1', 'c1', null, 9999)],
      [request('r1', 'c1', null, 1)],
    );

    const [c1] = tree.collections;
    expect(c1.folders).toHaveLength(1);
    expect(c1.requests).toHaveLength(1);
    // They never interleave, so the folder's much larger position is irrelevant.
    expect(c1.folders[0].id).toBe('f1');
    expect(c1.requests[0].id).toBe('r1');
  });

  describe('orphans', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => warn.mockRestore());

    it('attaches an orphan folder to the collection root instead of dropping it', () => {
      // A silently vanishing subtree is undiagnosable from the UI. Ugly and
      // visible beats invisible.
      const tree = buildTree(
        'ws-1',
        [collection('c1', 1024)],
        [folder('f-orphan', 'c1', 'missing-parent', 1024)],
        [],
      );

      expect(tree.collections[0].folders.map((f) => f.id)).toEqual([
        'f-orphan',
      ]);
      expect(tree.collections[0].folders[0].parentFolderId).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('f-orphan'));
    });

    it('attaches an orphan request to the collection root instead of dropping it', () => {
      const tree = buildTree(
        'ws-1',
        [collection('c1', 1024)],
        [],
        [request('r-orphan', 'c1', 'missing-folder', 1024)],
      );

      expect(tree.collections[0].requests.map((r) => r.id)).toEqual([
        'r-orphan',
      ]);
      expect(tree.collections[0].requests[0].folderId).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('r-orphan'));
    });

    it('drops a row belonging to a collection outside this workspace', () => {
      // Not an orphan — a row that is simply not part of this tree. Attaching
      // it to a root it does not belong to would be the actual leak.
      const tree = buildTree(
        'ws-1',
        [collection('c1', 1024)],
        [folder('f-elsewhere', 'c-other', null, 1024)],
        [request('r-elsewhere', 'c-other', null, 1024)],
      );

      expect(tree.collections[0].folders).toHaveLength(0);
      expect(tree.collections[0].requests).toHaveLength(0);
    });
  });
});
