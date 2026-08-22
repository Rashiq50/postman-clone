# Postman Import — Collections + Environments

## Context

Raven has no way in for existing Postman users: collections and environments must be rebuilt by hand. This slice adds import of **Postman Collection v2.x JSON** (v2.0 and v2.1) and **Postman Environment JSON**, mapping everything into our system. Per user decisions:

- **Body types** we don't send yet (xml, multipart form-data, graphql, binary) become **real modes in the `RequestBody` union** — stored faithfully, editable where sensible, Send handles/warns ("map now, implement later").
- **Unsupported Postman auth** (oauth2, digest, awsv4, ntlm, hawk, edgegrid, jwt, oauth1, asap) becomes a **placeholder variant** — stored, shown read-only, sends no auth + warning.
- **Collection-level auth and variables get real storage** (two jsonb columns on `collections`), so `auth: 'inherit'` finally has something to inherit from later. The execution service already reserves both seams (`buildVariables` ordered scopes; the `inherit` case comment).
- **Parsing lives in the backend**: `POST /import/collection` and `POST /import/environment`, one transaction, bulk inserts, `201` with `warnings[]`. No new `ApiErrorCode` (house rule — partial results are data). Client does one `resyncTree` (cold path).
- **Scripts**: Postman `event[]` → `RequestScripts`, with `pm.` rewritten to `rv.` (scripts are stored, never executed).

## Key decisions (settled)

| Topic | Decision |
|---|---|
| Versions | Accept v2.0 and v2.1 (`info.schema` matched); the material diff is url-string-vs-object, handled by one `parseUrl` helper. Anything else → 400. |
| Env import path | Through the import controller too (not bare `POST /environments`) — consistent `warnings[]`. |
| Folder-level variables | Folded into collection variables; first-seen wins on key conflict + `variable-conflict` warning. |
| Folder-level auth | Dropped with `folder-auth-dropped` warning; requests stay `inherit` (flattening would duplicate secrets N×). |
| Collection/folder `event[]` | Dropped with `collection-script-dropped` warning per non-empty script. |
| Collection auth/vars at send | **Storage only this slice** — wiring into Send is the recorded follow-up. |
| Unsupported auth shape | One generic variant `{ type: 'unsupported'; scheme; params: KeyValueEntry[] }` (not 7 pickable Select entries). |
| Send for new bodies | `xml` and `graphql` are **implemented** (~15 lines of text serialization); `form-data`/`binary` send no body + warning. |
| URL/params mapping | `url` = Postman `url.raw` (canonical, matches frontend urlQuery doctrine); `queryParams` gets **only disabled rows** (`enabled:false`). Safe: `interpolate.ts:124` filters to enabled rows, so nothing ever doubles. |
| Unknown HTTP method | Coerce to `GET` + `unsupported-method` warning. |
| Dialog | One auto-detecting `ImportDialog` (file button, no drag-drop — app's first file input), triggered from Sidebar header and EnvironmentsDialog (`only="environment"`). |
| Throttling | None (authenticated cold path, bounded by size + item caps); note in controller. |

## Phase 0 — Contracts (`packages/contracts/src`), then `./dev.sh contracts`

**`request.ts`** (no TS `enum`s — erasableSyntaxOnly):
- `REQUEST_BODY_MODES` += `'xml' | 'graphql' | 'form-data' | 'binary'`.
- New `FormDataEntry { key; value; enabled; type: 'text' | 'file' }` (file rows: `value` holds Postman `src` path, display-only placeholder).
- `RequestBody` union += `{mode:'xml'; text}` | `{mode:'graphql'; query; variables}` (variables = raw JSON text, Postman's storage) | `{mode:'form-data'; entries: FormDataEntry[]}` | `{mode:'binary'; src}`.
- `REQUEST_AUTH_TYPES` += `'unsupported'`; `POSTMAN_UNSUPPORTED_AUTH_SCHEMES = ['oauth1','oauth2','digest','awsv4','ntlm','hawk','edgegrid','jwt','asap'] as const`.
- `RequestAuth` += `{ type:'unsupported'; scheme: PostmanAuthScheme; params: KeyValueEntry[] }`.

**`collection.ts`**: `CollectionAuth = Exclude<RequestAuth, {type:'inherit'}>`; `Collection` gains `auth: CollectionAuth; variables: KeyValueEntry[]`; both optional on Create/Update inputs.

**`execution.ts`**: `SEND_WARNING_KINDS` += `'unsupported-body-mode' | 'unsupported-auth-type' | 'invalid-graphql-variables'`.

**New `import.ts`** (+ barrel export):
```ts
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_ITEMS = 5000; // folders + requests
export const IMPORT_WARNING_KINDS = ['unsupported-auth','unsupported-body','unsupported-method',
  'folder-auth-dropped','folder-variables-merged','variable-conflict','collection-script-dropped',
  'path-variables','examples-dropped','file-placeholder','globals-as-environment'] as const;
export interface ImportWarning { kind: ImportWarningKind; path: string; message: string }
export interface ImportCollectionInput { workspaceId: string; data: unknown }  // raw Postman JSON, opaque on the wire
export interface ImportCollectionResult { collection: Collection; folderCount: number; requestCount: number; warnings: ImportWarning[] }
export interface ImportEnvironmentInput { workspaceId: string; data: unknown }
export interface ImportEnvironmentResult { environment: Environment; warnings: ImportWarning[] }
```
Postman source types stay backend-internal (`postman-types.ts`), never in contracts.

## Phase 1 — Migration + entity

- `collection.entity.ts`: two jsonb columns, defaults as SQL expressions spelled the Postgres-normalized way, no `::jsonb` cast: `default: () => `'{"type": "none"}'`` (space after colon) and `'[]'`.
- `yarn migration:generate src/database/migrations/AddCollectionAuthAndVariables` → **discard the expected composite-FK + sessions-FK noise**; net: two `ALTER TABLE "collections" ADD ... jsonb NOT NULL DEFAULT ...`. Re-generate once to confirm only known drift remains.
- `collection-response.dto.ts`: `@Expose() auth/variables` (forced by `implements Collection`). Create/Update DTOs: optional `@Validate(CollectionAuthConstraint)` / `@Validate(KeyValueEntriesConstraint)`. `collections.service.ts create()` passes explicit defaults so the returned entity is complete without a re-read. Tree contract/`build-tree.ts`: **no change**.

## Phase 2 — Shared backend

**`requests/dto/json-constraints.ts`** (+ spec): extend `isRequestBody` (xml→text string; graphql→query+variables strings; form-data→new `isFormDataEntries`; binary→src string) and `isRequestAuth` (`'unsupported'` → scheme in list + `isKeyValueEntries(params)`). New `isCollectionAuth` (= isRequestAuth ∧ type ≠ inherit) + constraint class.

**Execution** — the exhaustive switches are the compiler's worklist:
- `interpolate.ts` `applyBody`: xml like raw; graphql interpolates query+variables; form-data interpolates text entries (file `value` untouched); binary untouched. Add cases to `interpolate.spec.ts`.
- `execution.service.ts` `buildBody` (grows a `warnings` param): xml → `application/xml`; graphql → JSON `{query, variables}` with variables `JSON.parse`d when valid else omitted + `invalid-graphql-variables`; form-data/binary → `null` + `unsupported-body-mode`. `applyAuth` case `'unsupported'` → apply nothing + `unsupported-auth-type` naming the scheme.
- Frontend needs no warning UI — `ResponsePane` already renders `warnings` verbatim.

**Body-parser limit**: Nest default is 100 kB; real Postman exports routinely exceed it. `main.ts`: `NestFactory.create(AppModule, { bodyParser: false })`; `configure-app.ts`: `app.use(json({ limit: IMPORT_MAX_BYTES }))` with a comment. Existing e2e apps that don't pass `{bodyParser:false}` keep Nest's default; only `import.e2e-spec.ts` opts out so `configureApp`'s limit governs there (note the asymmetry in the spec).

## Phase 3 — Backend `ImportModule` (`backend/src/import/`)

Imports **nothing from `WorkspacesModule`** (plain-function scope fragments, per doctrine). Files: `import.module.ts`, `import.controller.ts` (`@Controller({ path: 'import', version: API_VERSION })`), `import.service.ts`, `postman-types.ts`, `postman-collection.mapper.ts` (+spec), `postman-environment.mapper.ts` (+spec), `pm-script-rewrite.ts` (+spec), `fixtures/`, `dto/` (`import-collection.dto.ts`, `import-environment.dto.ts`, `postman-constraints.ts`, `import-result.dto.ts`).

**DTO validation** (`forbidNonWhitelisted`-safe, the `json-constraints` opaque-object precedent): `data: unknown` checked by one `@ValidatorConstraint` each. Collection: plain object, `info.schema` matches `getpostman.com/json/collection/v2.(0|1).0`, `info.name` non-empty, `item` array, recursive count ≤ `IMPORT_MAX_ITEMS`. Environment: `values` array of `{key: string, ...}`; `'globals'` scope accepted (mapper warns).

**Mapper** — pure `mapPostmanCollection(source: unknown): MappedImport`, ids via `crypto.randomUUID()` so parent links exist pre-insert; positions per fresh sibling set = `(i+1)*1024` (no MAX queries under a brand-new collection); warning `path` = ancestor-name join.

Mapping table:

| Postman | Raven |
|---|---|
| `info.name`/`description` (string or `{content}`) | collection name (truncate 200) / description |
| collection `variable[]` | `collection.variables` (`enabled: !disabled`, `String()`-coerced values) |
| item-group | Folder (fallback "Untitled folder"); its `auth` dropped + warn; its `variable[]` folded into collection vars (first-seen wins + warn); its `event[]` dropped + warn |
| `request.method` | if in `HTTP_METHODS`, else `GET` + `unsupported-method` |
| `url` string / object | verbatim / `url.raw`, else join protocol+host+path+enabled query (pure helper; never `new URL()` — `{{vars}}`) |
| `url.query[]` | **disabled rows only** → `queryParams` `enabled:false`; enabled rows live in URL text |
| `url.variable[]` (`:id`) | left literal + `path-variables` warning |
| `header[]` (v2.0 raw string handled too) | `headers`, `enabled: !disabled` |
| body raw+`options.raw.language` | json→`json`, xml→`xml`, else `raw`; `urlencoded`→`form-urlencoded`; `formdata`→`form-data` (file rows → `type:'file'`, `value:src` + `file-placeholder`); `graphql`→`graphql`; `file`→`binary` + warn; absent/disabled→`none` |
| auth absent | `inherit` (Postman semantics); `noauth`→`none`; bearer/basic/apikey → existing variants (one `authParams()` normalizer for v2.1 array vs v2.0 object params); listed unsupported schemes → `{type:'unsupported', scheme, params}` + warn; unknown scheme → `none` + warn |
| collection `auth` | `collection.auth` via same mapping (absent → `{type:'none'}`) |
| request `event[]` | `exec` join `'\n'` (same-listen events joined `'\n\n'`) → pre/postRequest → pm→rv rewrite |
| `response[]` examples | dropped, one aggregate `examples-dropped` with count |
| `protocolProfileBehavior`, `_postman_id`, rest | dropped silently |

**pm→rv rewrite** (`pm-script-rewrite.ts`):
```ts
script.replace(/(^|[^A-Za-z0-9_$.])pm(?=\s*\.)/g, '$1rv')
```
Token-boundary only (`pm.test`, `!pm.expect` rewrite; `spm.foo`, `x.pm.y` don't). Accepted, documented collateral: `pm.` inside string literals/comments also rewrites — scripts are stored, never executed; no JS tokenizer for a display-only field. `postman.*` legacy API left untouched.

**`import.service.ts`** — one `manager.transaction`:
1. Scoped workspace check — exact `SCOPED_WORKSPACE_IDS` + `scopeParams(userId, WRITE_ROLES)` query from `collections.service.ts create()`; on miss `explainParentDenial` (404 non-member / 403 VIEWER).
2. Map (already structurally validated; mapper stays total/defensive).
3. `appendPosition(manager, 'collections', '"workspaceId" = $1', [id])` **once** — only the collection has existing siblings.
4. Insert collection → folders **grouped by depth ascending** (one multi-row `insert()` per level — composite `FK_folders_parent` needs parents present) → all requests bulk `insert()` chunked at 500. Both composite FK column pairs populated.

`importEnvironment`: same scoped check; `mapPostmanEnvironment` (`{key, value: String(value ?? ''), enabled: enabled !== false, secret: type === 'secret' ? true : undefined}`, name fallback "Imported environment", globals warning); `appendPosition` on environments; single insert.

Controller: `201`, `@Expose()`-only result DTOs with static `from()` (collection via `CollectionResponseDto.from`). Never a bare entity.

## Phase 4 — Frontend

**Do BodyTab/AuthTab first** — the exhaustive `emptyBody`/`emptyAuth` switches are the compile-error worklist.
- `BodyTab.tsx`: xml → CodeMirror as text (**no `@codemirror/lang-xml`** — no new deps); graphql → two stacked editors (Query text, Variables json + Format); form-data → `KeyValueEditor` with `type` merged back positionally in `onChange` (new rows `'text'`), one-line `text-fg-faint` note that file rows are import placeholders; binary → placeholder panel showing `src`.
- `AuthTab.tsx`: `'unsupported'` reachable in the Select only when it's the current value (labeled "unsupported (imported)"); renders a banner (ScriptsTab pattern) — stored as imported, sends **no auth** — plus a read-only params table. Existing tokens only.

**`features/import/`**:
- `importApi.ts`: `baseApi.injectEndpoints`; `importCollection` → await `queryFulfilled` then `resyncTree(api, workspaceId)` (`treePatch.ts`); `importEnvironment` → `invalidatesTags [{type:'Environment', id:`LIST-${workspaceId}`}]`. No new tag types.
- `postmanFile.ts` (pure module — the `responseFile.ts` split, keeps oxlint `only-export-components` clean): `detectImportKind(json)` (`info?.schema`+`item` → collection; `values`/`_postman_variable_scope` → environment), `parseImportFile(file)` (size pre-check vs `IMPORT_MAX_BYTES`, `file.text()`, friendly JSON.parse error).
- `ImportDialog.tsx`: `Dialog size="lg"`, hidden `<input type="file" accept=".json,application/json">` behind a styled button; pick → detect → confirm → success summary (counts + warnings grouped by kind, `message` verbatim) with Close. Errors via `errorMessage` from `lib/api-error`. `only?: 'environment'` prop.
- Triggers: `Sidebar.tsx` header "Import" button beside New collection — plain `useState`, **not** in the memoized `handlers` deps (no row re-renders); `EnvironmentsDialog.tsx` "Import" beside "+ New" with `only="environment"`.

## Phase 5 — Tests

- Mapper specs with real-shaped v2.1 fixture (every table row: nested folders, all bodies, all auths, events, collection/folder vars, path vars, disabled flags, description-object, examples) + v2.0 fixture (url string, object auth params).
- `pm-script-rewrite.spec.ts` (API forms, boundary negatives, multiline, pinned string-literal collateral); env mapper spec; `json-constraints.spec.ts` new branches; `interpolate.spec.ts` new body branches.
- `backend/test/import.e2e-spec.ts` (model: `workspaces.e2e-spec.ts`; `e2e-import-` email-prefix cleanup, CASCADE sweeps): happy path → 201 counts/warnings → tree shows structure → `GET /requests/:id` round-trips body/auth/`rv.` scripts; env import w/ secret; cross-tenant workspaceId → 404; VIEWER → 403; wrong schema → 400 `VALIDATION_FAILED`; oversize → 413 (this spec creates its app with `{bodyParser:false}`).
- `send.e2e-spec.ts` additions: xml → `application/xml`; form-data → no body + `unsupported-body-mode`; unsupported auth → no `Authorization` + `unsupported-auth-type`.
- Frontend: no runner — manual checklist (import a real export + env; open/edit/save/send each new mode; warnings render; tree refetches). `yarn lint` both sides, `yarn build`, `yarn contrast` stay clean.

## Sequencing (strict)

1. Contracts → `./dev.sh contracts`
2. Entity + migration → `yarn migration:run`; re-generate to confirm only known drift
3. Shared backend: json-constraints, collection DTOs/service, interpolate + execution.service, body-parser limit
4. `ImportModule` + unit specs; register in `app.module.ts`
5. `yarn test` → e2e (`--runInBand`)
6. Frontend: BodyTab/AuthTab, then import feature + triggers
7. `yarn lint` / `yarn build` / `yarn contrast`; manual run-through against the running stack

## Deliberate follow-up seams (not this slice)

- Wire collection `auth` into Send's `inherit` case (one JOIN in load + one `applyAuth` branch) and collection `variables` into `buildVariables`' ordered scopes — both seams already commented in `execution.service.ts`.
- Multipart/binary sending (blocked on the file-upload storage question).
- Script execution (`rv.*` runtime) — separate slice per README.
