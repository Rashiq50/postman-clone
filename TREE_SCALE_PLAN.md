# Sidebar tree at scale — plan

Goal: the tree stays **snappy and instant** at ~500 collections × 5+ levels deep
(~20–30k nodes), without virtualization. Two problems to solve, in order of what
the user feels:

1. **Interaction latency** — today every create/move/delete/rename invalidates
   the single `Tree` tag and refetches the entire workspace tree. At scale that
   is a multi-hundred-ms stall after every structural edit.
2. **Payload on load** — the whole workspace arrives eagerly. At scale that is
   2–4 MB of JSON the user mostly never opens.

The fix for (1) is **cache patching** (optimistic where the client can predict
the outcome, response-patched where it needs a server id). The fix for (2) is
**lazy per-collection subtrees with hover prefetch**. They are independent;
patching ships first and is worth doing even if (2) never becomes necessary.

Multi-tab is a stated constraint throughout — see the dedicated section. The
short version: **no `BroadcastChannel`, no new persistence; tabs converge by
refetch-on-focus**, consistent with how auth already treats tabs.

---

## Phase 1 — Stop re-rendering the whole tree (prerequisite)

Cache patches are pointless if every patch re-renders every mounted row. Today
`Sidebar` rebuilds `handlers` each render, `useExpanded` hands out a new
`isExpanded` identity on every toggle, and no node view is memoized — so one
chevron click re-renders everything mounted.

- Wrap `CollectionNodeView`, `FolderNodeView`, `RequestNodeView` in
  `React.memo`.
- Make the props they receive referentially stable:
  - `useExpanded`: expose the `ReadonlySet` itself (plus stable `toggle`/
    `expandAll` — already `useCallback`ed). Node views read
    `expandedSet.has(id)`; a toggle then changes only the set identity, and
    memoized subtrees whose slice of the tree object didn't change still bail
    out on everything except the expanded flag they actually consume. Pass the
    set through the existing `TreeHandlers` object, but build that object with
    `useMemo` in `Sidebar`.
  - `menuFor` currently runs during render for **every** mounted row, allocating
    a `MenuItem[]` each time. Move menu construction to open-time: `NodeMenu`
    takes a `getItems: () => MenuItem[]` thunk and calls it only when the ⋯
    button opens the menu. This also removes `menuFor`'s closure over unstable
    state from the memo equation.
  - `commitRename` / callbacks in `Sidebar`: hoist into `useCallback` (or a
    single `useMemo`d handlers object) keyed on the few things they truly close
    over (`ws`, `tree` via a ref where needed).
- `renamingId` and `activeRequestId` change rarely; passing them through the
  handlers object is fine once the object itself is memoized — a rename or
  navigation legitimately re-renders the rows involved.

Acceptance: with a few thousand rows expanded, a chevron toggle re-renders only
the toggled subtree (verify with React DevTools "highlight updates").

---

## Phase 2 — Cache patching: mutations update the tree in memory

Replace `invalidatesTags: treeTag(...)` with direct cache writes. The user's
action lands in the sidebar at memory speed; the server round trip happens
behind it.

### 2.1 Shared patch helpers

New module `frontend/src/features/tree/treeCache.ts` — pure functions over a
`WorkspaceTree` draft (they run inside immer via
`treeApi.util.updateQueryData('getTree', workspaceId, draft => ...)`):

- `insertCollection(draft, collection)` — append at end (creates always append;
  the server computes `MAX + 1024`, and the response carries the real
  `position`).
- `insertFolder(draft, folder)` / `insertRequest(draft, request)` — locate the
  parent (collection root or folder), append to the right child array.
- `removeNode(draft, id)` — works for all three kinds; returns the removed
  node so move can re-insert it.
- `moveNode(draft, id, target, index?)` — remove + splice **at the requested
  index**, not by re-sorting on `position`. This matters: `positionForMove` on
  the backend can *renumber an entire sibling set* when the gap is exhausted,
  so positions in a patched cache can be stale. Array order in the cache is the
  render order; index-based placement keeps the UI correct while the numbers
  drift, and the background reconcile (Phase 3) trues the numbers up.
- `renameNode(draft, id, name)` — extract of the walk already living inline in
  `Sidebar.commitRename`; the existing optimistic rename switches to this
  helper.
- `setRequestMethod(draft, id, method)` — for the editor's method change.

Keep them dumb and total (no-throw on a missing id — a miss means the cache is
stale, and the reconcile fixes it). The frontend has no test runner; purity is
still worth it for readability and for a future runner.

### 2.2 Per-mutation strategy

Split by whether the client can predict the end state:

**Optimistic (patch immediately in `onQueryStarted`, before the request):**

- rename (collection/folder/request) — already done in `Sidebar`; move the
  patch into the mutation's `onQueryStarted` so every call site gets it, and
  delete the inline copy in `Sidebar.commitRename`.
- delete (all three kinds).
- move / reorder (folder, request, collection) — the client knows the target
  parent and index.
- request `method` change from the editor.

**Response-patched (await `queryFulfilled`, then patch with the returned DTO):**

- create collection / folder / request — needs the server-generated `id` and
  `position`. One round trip (~100 ms) before the row appears; for a
  menu-driven action that reads as instant. (If it ever doesn't: temp-id
  optimistic insert with id swap on response — deliberately out of scope now,
  it complicates every helper for marginal gain.)

**Error handling — two different rollbacks, on purpose:**

- Rename keeps `patch.undo()` — the failure surface is validation-ish, the
  revert is exact, and this is the pattern already proven in `Sidebar`.
- Structural ops (move/delete) on error do **not** undo — they
  `dispatch(baseApi.util.invalidateTags(treeTag(ws)))` instead. An undo after
  concurrent patches (or after a focus refetch replaced the cache object) can
  mis-apply; a refetch is the guaranteed-correct rollback, and errors are the
  rare path where one full fetch is fine.

### 2.3 What invalidation remains

- `updateRequest` drops its conditional `Tree` invalidation for `name`/`method`
  (replaced by patches) but **keeps** `{ type: 'Request', id }` invalidation so
  the editor cache stays truthful.
- `moveRequest` keeps its `Request:id` invalidation (the request's
  `folderId`/`collectionId` changed server-side).
- The `Tree` tag itself **stays**, now serving two jobs only: the error-path
  resync above, and Phase 3's reconcile. Do not delete `treeTag`.
- The `workspaceId` argument on every mutation **stays** — it is no longer only
  the invalidation key, it is now the *patch* key (`updateQueryData` needs it).
  Update the warning comments in `collectionsApi`/`foldersApi` accordingly
  rather than letting them go stale.

### 2.4 `Sidebar` cleanup

`commitRename`'s inline `updateQueryData` walk moves into the mutation.
`menuFor` stops needing `findFolder`/`findRequest` for reorder if the move
mutation's patch derives current parents itself — keep whichever direction is
smaller, but don't duplicate the walk in both places.

Acceptance: on a workspace with hundreds of collections, delete/move/rename/
reorder update the sidebar with **zero** tree refetch on the happy path (verify
in the network tab); create shows the new row after exactly one request.

---

## Phase 3 — Background reconcile (this is the multi-tab story)

Patched caches drift from the server: another tab, another workspace member
(`workspace_members` is real), or the position-renumber path above. The answer
is *patch for immediacy, reconcile in the background* — never a second realtime
channel.

- Call `setupListeners(store.dispatch)` in `app/store.ts` (not currently done).
- Enable `refetchOnFocus: true` and `refetchOnReconnect: true` for `getTree`
  (per-endpoint via the hook options or `injectEndpoints` config — scope it to
  the tree, not globally, so the request editor's draft behavior is untouched).
- Why focus is the right trigger: the moment a user *sees* tab B is the moment
  they switched to it — a focus refetch means tab B is fresh exactly when it
  becomes visible. Between focuses, staleness in a hidden tab is invisible by
  definition.
- The refetch replaces the cached tree object identity. Two places already
  tolerate that and must keep tolerating it:
  - `useRequestDraft` keys its seeding effect on `request?.id` (existing
    invariant — do not regress).
  - `useExpanded` keys on node ids, not object identity — expansion survives.
  With Phase 1's memoization, a reconcile that changes nothing re-renders
  nothing beyond the top-level map (immer/RTK structural sharing keeps
  unchanged subtree identities — verify this holds through `getRawMany`
  ordering being stable; `buildTree`'s deterministic sort guarantees it).

### Multi-tab rules (decisions, recorded so they don't get "fixed")

- **No `BroadcastChannel`, no `storage` events, no shared worker.** Same
  doctrine as auth (see CLAUDE.md): a broadcast layer is a second source of
  truth outside Redux, and every listener is a new consistency bug surface.
  Tabs converge by expiry/refetch, not by push.
- **Nothing new in `localStorage`.** The tree cache, expansion state, and drafts
  stay per-tab and in memory. The only persisted thing in this app remains the
  theme preference.
- Consequence to accept and document in CLAUDE.md when shipping: an edit in tab
  A appears in tab B on B's next focus (or reconnect), not instantly. That is
  the same convergence model auth already uses and it is the deliberate
  trade-off.
- Login/logout interplay is already handled: `resetApiState()` in the login and
  register submit handlers wipes user A's patched tree before user B's queries
  run, and `WorkspaceGuard` bounces a foreign `workspaceId` URL. No changes
  needed; do not add any.

---

## Phase 4 — Lazy per-collection subtrees with prefetch (scale)

Ship only when workspaces actually approach hundreds of collections; Phases 1–3
are what make interactions instant regardless. This phase fixes load-time
payload and shrinks the blast radius of the remaining refetches.

### 4.1 Backend

- `GET /api/v1/workspaces/:workspaceId/tree?depth=collections` — same
  `TreeController` (which deliberately lives in `CollectionsModule`; keep it
  there, `WorkspacesModule` stays import-free). Returns `WorkspaceTree` whose
  collections have **empty** `folders`/`requests` arrays — same contract type,
  no new DTO shape. Implementation: skip the folders/requests reads.
  A query param instead of a new route keeps one scoping/denial path
  (`scopedWhere` + `explainParentDenial` exactly as today).
- `GET /api/v1/collections/:id/tree` — one collection's subtree
  (`CollectionNode`). Also in `TreeController`. Scoping rule is the standard
  one: resolve the collection through the workspace-scoped query; 404 via
  `explainParentDenial` when the caller isn't a member, 403 never applies to a
  read. Reuses `buildTree` with a single collection (or a trimmed
  `buildCollectionSubtree` extracted from it — keep the orphan-to-root+log
  behavior either way).
- Contracts: `CollectionNode` already exists; add a response wrapper only if
  the envelope demands it. Any `packages/contracts/src` edit ⇒ run
  `./dev.sh contracts`.
- Tests: unit spec for the trimmed builder; extend `workspaces.e2e-spec.ts`
  with the cross-tenant assertion for the new subtree route (stranger → 404).

### 4.2 Frontend

- `treeApi` gains `getCollectionSubtree: query<CollectionNode, string>` with a
  new tag type `CollectionTree` (id = collectionId). Adding the tag is now
  legitimate under the existing rule — "each tag arrives with the feature that
  reads it" — because this endpoint provides it. Add it to `tagTypes` in
  `baseApi`.
- `getTree` is called with `?depth=collections`. `CollectionNodeView`, when
  expanded, renders children from `useGetCollectionSubtreeQuery(node.id)`
  instead of `node.folders`/`node.requests`.
- **Prefetch on intent, never spinner on expand:**
  - `const prefetch = usePrefetch('getCollectionSubtree')` in the sidebar;
    fire it on `pointerenter` (and `focus`, for keyboard users) of a collection
    row. Hover-to-click latency (~150–300 ms) usually covers the fetch.
  - On expand with data not yet in cache: render the collection row expanded
    with nothing beneath it and let children appear when data lands. No
    spinner, no layout shift placeholder. Subsequent expands hit cache and are
    instant (`keepUnusedDataFor` default is fine; consider raising it for the
    session).
- **Patching moves down a level.** The Phase 2 helpers operate per collection
  subtree instead of (or in addition to) the workspace tree. Mutations patch
  `getCollectionSubtree(collectionId)`; a **cross-collection move** patches two
  entries, so move mutations must carry both source and target collection ids
  in their argument — same convention as `workspaceId` today, and the same
  failure mode if forgotten ("sidebar doesn't update"), so document it in the
  same ⚠️ style in the api slices.
- Reconcile granularity improves for free: `refetchOnFocus` on the collections
  skeleton is tiny, and subtree refetches only touch collections with active
  subscriptions (expanded ones).
- **Deep links** (`/w/:ws/requests/:id` on a cold tab): the tree skeleton alone
  can't locate the request. Sequence: `getRequest(id)` already loads for the
  editor and its DTO carries `collectionId` → fetch that collection's subtree →
  `ancestorsOf` (rescoped to walk one `CollectionNode`) → `expandAll`. Wire
  this where the current `ancestorsOf` effect lives in `Sidebar`.
- **`MoveToDialog`** currently flattens the whole tree for targets; with lazy
  loading the tree isn't fully in memory. Give the dialog its own data path:
  reuse `getCollectionSubtree` per collection lazily *inside* the dialog
  (expandable target tree), and add a text filter box — at 500 collections a
  filter is needed for usability regardless of loading strategy. Do **not**
  eagerly fetch all 500 subtrees when the dialog opens.

Acceptance: cold load of a 500-collection workspace transfers only the
collection skeleton (KBs, not MBs); expanding a hovered collection shows
children with no visible wait; a mutation causes no request larger than one
collection's subtree.

---

## Explicit non-goals

- **No virtualization.** Collapse-unmounts plus lazy subtrees keep mounted row
  counts bounded by what the user has actually opened. Revisit only if profiling
  shows DOM size (not React) as the bottleneck.
- **No temp-id optimistic creates** (Phase 2.2 records why).
- **No realtime sync** (WebSocket/SSE/BroadcastChannel) — reconcile by focus.
- **No persistence of tree cache or expansion state.**

## Sequencing and risk

| Phase | Scope | Risk | Depends on |
|---|---|---|---|
| 1 Memoization | frontend only | low | — |
| 2 Cache patching | frontend only | medium (cache correctness) | 1 |
| 3 Reconcile | frontend only | low | 2 |
| 4 Lazy subtrees | backend + contracts + frontend | medium | 1–3 |

Phases 1–3 are one shippable unit with no API change and deliver the entire
"instant" feel. Phase 4 is a separate slice, gated on real workspace sizes.

Verification per phase: `cd frontend && yarn lint && yarn build` throughout;
backend phases add `yarn test` (new specs) and `yarn test:e2e` for the scoping
assertions; manual pass with the network tab open against a seeded large
workspace (a seed script generating ~500 collections × nested folders is worth
adding to make any of this measurable — put it under `backend/` as a one-off
script, not a migration).
