import { randomUUID } from 'node:crypto';
import {
  COLLECTION_NAME_MAX_LENGTH,
  HTTP_METHODS,
  POSTMAN_UNSUPPORTED_AUTH_SCHEMES,
  REQUEST_NAME_MAX_LENGTH,
  type CollectionAuth,
  type FormDataEntry,
  type HttpMethod,
  type ImportWarning,
  type KeyValueEntry,
  type PostmanAuthScheme,
  type RequestAuth,
  type RequestBody,
  type RequestScripts,
} from '@raven/contracts';
import { POSITION_GAP } from '../common/ordering';
import { rewritePmToRv } from './pm-script-rewrite';
import type {
  PostmanFormParam,
  PostmanItem,
  PostmanQueryParam,
  PostmanUrlObject,
} from './postman-types';

/**
 * Postman v2.x → our domain, as **one pure function**.
 *
 * ⚠️ **It is total: it never throws.** Structural validation already happened
 * at the DTO (`postman-constraints.ts`), and everything past that point is a
 * stranger's file — a number where a string belongs, a `null` item, a body mode
 * nobody has heard of. Every one of those is a *warning plus a defensible
 * default*, never an exception, because the alternative is a 900-request import
 * that fails on request 400 and leaves the user with nothing. The house rule
 * this follows is the send path's: **partial results are data, not errors.**
 *
 * ⚠️ **Ids are minted here, not by the database.** `randomUUID()` up front is
 * what lets the whole tree exist as plain objects with real parent links before
 * a single row is written — which is in turn what lets the service insert
 * folders one depth level at a time and requests in bulk, instead of walking
 * the tree with one round trip per node.
 *
 * ⚠️ **Positions are computed, not queried.** Every sibling set here is brand
 * new, so `(i + 1) * POSITION_GAP` is exactly what `appendPosition` would have
 * returned had it been asked once per node — with no `MAX()` query per set. The
 * one place that *does* have existing siblings is the collection among the
 * workspace's other collections, and that one position is the service's job.
 */

export interface MappedFolder {
  id: string;
  collectionId: string;
  parentFolderId: string | null;
  name: string;
  position: number;
  /** 0 at the collection root. The service inserts one depth level at a time. */
  depth: number;
}

export interface MappedRequest {
  id: string;
  collectionId: string;
  folderId: string | null;
  name: string;
  method: HttpMethod;
  url: string;
  description: string | null;
  headers: KeyValueEntry[];
  queryParams: KeyValueEntry[];
  body: RequestBody;
  auth: RequestAuth;
  scripts: RequestScripts;
  position: number;
}

export interface MappedCollection {
  id: string;
  name: string;
  description: string | null;
  auth: CollectionAuth;
  variables: KeyValueEntry[];
}

export interface MappedImport {
  collection: MappedCollection;
  folders: MappedFolder[];
  requests: MappedRequest[];
  warnings: ImportWarning[];
}

/* ------------------------------------------------------------------ */
/* Coercion helpers. Everything below assumes it was handed garbage.    */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * ⚠️ `String()`-coerced, not rejected. Postman writes numbers and booleans into
 * variable and header values freely (`{ "key": "port", "value": 8080 }`), and
 * our columns are `string`. Dropping those rows would lose real data; coercing
 * them is what the user sees in Postman's own UI anyway.
 */
function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

/**
 * A description is a string or `{ content }` in both schema versions.
 *
 * Typed `unknown` rather than `PostmanDescription`: the union would be widened
 * to `unknown` by its own third member anyway, and this is called on fields
 * from a file nothing has validated.
 */
function asDescription(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value;
  if (isPlainObject(value) && typeof value.content === 'string') {
    return value.content === '' ? null : value.content;
  }
  return null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** Postman's `disabled: true` is our `enabled: false`; absent means enabled. */
function enabledFrom(disabled: unknown): boolean {
  return disabled !== true;
}

/* ------------------------------------------------------------------ */
/* URL                                                                  */
/* ------------------------------------------------------------------ */

/**
 * The URL text, which is **canonical** — it is what the URL bar shows and what
 * the send path parses.
 *
 * ⚠️ **Never `new URL()`, in either direction.** A Postman URL is full of
 * `{{baseUrl}}`, which fails to parse, and percent-encoding would mangle `{{`
 * into `%7B%7B`. This is the same doctrine the frontend's `urlQuery.ts` holds
 * to, and it is why this is plain string assembly.
 *
 * `raw` is preferred when present because it is what the author actually typed,
 * including any spacing and any `{{var}}` spanning the host/path boundary. The
 * reassembly below is the fallback for exports that omit it.
 */
export function postmanUrlToText(url: unknown): string {
  if (typeof url === 'string') return url;
  if (!isPlainObject(url)) return '';

  const source = url as PostmanUrlObject;
  if (typeof source.raw === 'string') return source.raw;

  const protocol = asString(source.protocol);
  const host = Array.isArray(source.host)
    ? source.host.map((part) => asString(part)).join('.')
    : asString(source.host);
  const port = asString(source.port);
  const path = Array.isArray(source.path)
    ? source.path.map((part) => asString(part)).join('/')
    : asString(source.path);

  let text = '';
  if (protocol !== '') text += `${protocol}://`;
  text += host;
  if (port !== '') text += `:${port}`;
  if (path !== '') text += path.startsWith('/') ? path : `/${path}`;

  // Only *enabled* rows go into the text; disabled ones are carried in
  // `queryParams` instead — see `splitQuery` below.
  const query = asArray(source.query)
    .filter(isPlainObject)
    .filter((row) => enabledFrom(row.disabled))
    .map((row) => {
      const key = asString((row as PostmanQueryParam).key);
      const value = asString((row as PostmanQueryParam).value);
      return value === '' ? key : `${key}=${value}`;
    })
    .filter((pair) => pair !== '');

  if (query.length > 0) text += `?${query.join('&')}`;

  const hash = asString(source.hash);
  if (hash !== '') text += `#${hash}`;

  return text;
}

/**
 * ⚠️ **Only the *disabled* query rows become `queryParams`.**
 *
 * Every enabled row is already present in the URL text, and the send path
 * *appends* `queryParams` onto whatever the URL carries — so returning them
 * here as well would double every parameter on the first send. Disabled rows
 * are safe precisely because `interpolate.ts` filters to enabled rows before
 * anything is appended, so they round-trip into the Params table, stay visible
 * and untickable, and never reach the wire.
 *
 * This is the same split the frontend already lives by: "the URL text is
 * canonical; the table holds what the text cannot express", and a disabled row
 * is exactly what a query string cannot express.
 */
function disabledQueryRows(url: unknown): KeyValueEntry[] {
  if (!isPlainObject(url)) return [];
  return asArray((url as PostmanUrlObject).query)
    .filter(isPlainObject)
    .filter((row) => !enabledFrom(row.disabled))
    .map((row) => ({
      key: asString((row as PostmanQueryParam).key),
      value: asString((row as PostmanQueryParam).value),
      enabled: false,
    }));
}

/* ------------------------------------------------------------------ */
/* Headers                                                              */
/* ------------------------------------------------------------------ */

/**
 * v2.1 writes an array of `{ key, value, disabled }`; v2.0 may write the whole
 * header block as one `\n`-delimited raw string. Both are handled here rather
 * than by branching on the schema version, because both spellings turn up in
 * files claiming either version.
 */
function mapHeaders(header: unknown): KeyValueEntry[] {
  if (typeof header === 'string') {
    return header
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('//'))
      .map((line) => {
        const colon = line.indexOf(':');
        return colon === -1
          ? { key: line, value: '', enabled: true }
          : {
              key: line.slice(0, colon).trim(),
              value: line.slice(colon + 1).trim(),
              enabled: true,
            };
      });
  }

  return asArray(header)
    .filter(isPlainObject)
    .map((row) => ({
      key: asString(row.key),
      value: asString(row.value),
      enabled: enabledFrom(row.disabled),
    }));
}

/* ------------------------------------------------------------------ */
/* Auth                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The one normalizer for the v2.0/v2.1 auth-params split: v2.1 stores
 * `bearer: [{ key: 'token', value: '…' }]`, v2.0 stores
 * `bearer: { token: '…' }`. Both collapse to a flat map here so every scheme
 * below reads its fields the same way and neither version is a special case.
 */
export function authParams(value: unknown): Map<string, string> {
  const params = new Map<string, string>();

  if (Array.isArray(value)) {
    for (const row of value) {
      if (!isPlainObject(row)) continue;
      const key = asString(row.key);
      if (key !== '') params.set(key, asString(row.value));
    }
    return params;
  }

  if (isPlainObject(value)) {
    for (const [key, raw] of Object.entries(value)) {
      params.set(key, asString(raw));
    }
  }

  return params;
}

function paramRows(params: Map<string, string>): KeyValueEntry[] {
  return [...params].map(([key, value]) => ({ key, value, enabled: true }));
}

/**
 * `absent` is a distinct answer from `{ type: 'none' }`.
 *
 * ⚠️ In Postman, a request with no `auth` key **inherits from its parent**;
 * `auth: { type: 'noauth' }` is an explicit "send nothing". Collapsing the two
 * would either strip a collection's credential from every request under it or
 * silently attach one to a request the author had opted out. The caller decides
 * what an absence means — a request maps it to `inherit`, a collection to
 * `none`, since a collection has no parent.
 */
function mapAuth(
  auth: unknown,
  path: string,
  warnings: ImportWarning[],
): RequestAuth | 'absent' {
  if (auth === undefined || auth === null) return 'absent';
  if (!isPlainObject(auth)) return 'absent';

  const type = asString(auth.type);
  if (type === '') return 'absent';
  if (type === 'noauth') return { type: 'none' };

  const params = authParams(auth[type]);

  switch (type) {
    case 'bearer':
      return { type: 'bearer', token: params.get('token') ?? '' };
    case 'basic':
      return {
        type: 'basic',
        username: params.get('username') ?? '',
        password: params.get('password') ?? '',
      };
    case 'apikey': {
      // Postman's `in` is 'header' | 'query', defaulting to header.
      const where = params.get('in');
      return {
        type: 'apiKey',
        key: params.get('key') ?? '',
        value: params.get('value') ?? '',
        in: where === 'query' ? 'query' : 'header',
      };
    }
    default:
      break;
  }

  if (POSTMAN_UNSUPPORTED_AUTH_SCHEMES.includes(type as PostmanAuthScheme)) {
    warnings.push({
      kind: 'unsupported-auth',
      path,
      message: `"${type}" auth was imported and stored, but cannot be sent. Sending this request will send no auth.`,
    });
    return {
      type: 'unsupported',
      scheme: type as PostmanAuthScheme,
      params: paramRows(params),
    };
  }

  // A scheme we have never heard of. Storing it as `unsupported` is not
  // available — `PostmanAuthScheme` is a closed list, and widening it to
  // `string` would put an unvalidatable value in a jsonb column — so it
  // becomes `none` and says so.
  warnings.push({
    kind: 'unsupported-auth',
    path,
    message: `Auth type "${type}" is not recognised and was dropped. This request will send no auth.`,
  });
  return { type: 'none' };
}

/* ------------------------------------------------------------------ */
/* Body                                                                 */
/* ------------------------------------------------------------------ */

/** `options.raw.language` — how Postman records that a raw body is JSON/XML. */
function rawLanguage(options: unknown): string {
  if (!isPlainObject(options)) return '';
  const raw = options.raw;
  if (!isPlainObject(raw)) return '';
  return asString(raw.language);
}

function mapBody(
  body: unknown,
  path: string,
  warnings: ImportWarning[],
): RequestBody {
  if (!isPlainObject(body)) return { mode: 'none' };
  // A whole body can be disabled in Postman; that is a body of none, not an
  // empty one of its original mode.
  if (body.disabled === true) return { mode: 'none' };

  const mode = asString(body.mode);

  switch (mode) {
    case 'raw': {
      const text = asString(body.raw);
      const language = rawLanguage(body.options);
      if (language === 'json') return { mode: 'json', text };
      if (language === 'xml') return { mode: 'xml', text };
      // `html`, `javascript`, `text`, or no language at all: `raw` carries the
      // text faithfully and the only thing lost is an editor highlight mode we
      // do not have anyway.
      return { mode: 'raw', text };
    }

    case 'urlencoded':
      return {
        mode: 'form-urlencoded',
        entries: asArray(body.urlencoded)
          .filter(isPlainObject)
          .map((row) => ({
            key: asString(row.key),
            value: asString(row.value),
            enabled: enabledFrom(row.disabled),
          })),
      };

    case 'formdata': {
      let sawFile = false;
      const entries: FormDataEntry[] = asArray(body.formdata)
        .filter(isPlainObject)
        .map((row) => {
          const param = row as PostmanFormParam;
          const isFile = asString(param.type) === 'file';
          if (isFile) sawFile = true;
          return {
            key: asString(param.key),
            // ⚠️ For a file row this is the **path Postman recorded**, not
            // content — nothing is uploaded. See `FormDataEntry` in contracts.
            value: isFile
              ? Array.isArray(param.src)
                ? param.src.map((part) => asString(part)).join(', ')
                : asString(param.src)
              : asString(param.value),
            enabled: enabledFrom(param.disabled),
            type: isFile ? ('file' as const) : ('text' as const),
          };
        });

      if (sawFile) {
        warnings.push({
          kind: 'file-placeholder',
          path,
          message:
            'This form-data body has file fields. Only the file paths were imported — no files were uploaded, and this body cannot be sent yet.',
        });
      }
      return { mode: 'form-data', entries };
    }

    case 'graphql': {
      const source = isPlainObject(body.graphql) ? body.graphql : {};
      // ⚠️ `variables` is stored as raw *text*. Postman does the same, an
      // in-progress edit is routinely not valid JSON, and re-serialising an
      // object here would silently reformat what the author wrote. An object
      // that somehow arrives is stringified rather than dropped.
      const variables = isPlainObject(source.variables)
        ? JSON.stringify(source.variables, null, 2)
        : asString(source.variables);
      return { mode: 'graphql', query: asString(source.query), variables };
    }

    case 'file': {
      const source = isPlainObject(body.file) ? body.file : {};
      warnings.push({
        kind: 'file-placeholder',
        path,
        message:
          'This request sends a file as its body. Only the file path was imported — no file was uploaded, and this body cannot be sent yet.',
      });
      return { mode: 'binary', src: asString(source.src) };
    }

    case '':
    case 'none':
      return { mode: 'none' };

    default:
      warnings.push({
        kind: 'unsupported-body',
        path,
        message: `Body mode "${mode}" is not recognised and was dropped.`,
      });
      return { mode: 'none' };
  }
}

/* ------------------------------------------------------------------ */
/* Scripts                                                              */
/* ------------------------------------------------------------------ */

function eventSource(event: unknown): { listen: string; code: string } | null {
  if (!isPlainObject(event)) return null;
  if (event.disabled === true) return null;

  const script = event.script;
  if (!isPlainObject(script)) return null;

  const exec = script.exec;
  // `exec` is an array of lines, but a plain string turns up in older exports.
  const code = Array.isArray(exec)
    ? exec.map((line) => asString(line)).join('\n')
    : asString(exec);

  if (code.trim() === '') return null;
  return { listen: asString(event.listen), code };
}

/**
 * Postman allows **several events on the same listener**, and they run in
 * order. Joining them with a blank line keeps that order visible rather than
 * silently keeping only the last one.
 */
function mapScripts(events: unknown): RequestScripts {
  const pre: string[] = [];
  const post: string[] = [];

  for (const event of asArray(events)) {
    const source = eventSource(event);
    if (!source) continue;
    if (source.listen === 'prerequest') pre.push(source.code);
    else if (source.listen === 'test') post.push(source.code);
  }

  return {
    preRequest: rewritePmToRv(pre.join('\n\n')),
    postRequest: rewritePmToRv(post.join('\n\n')),
  };
}

/** True when the node carries at least one script worth warning about. */
function hasScripts(events: unknown): boolean {
  return asArray(events).some((event) => eventSource(event) !== null);
}

/* ------------------------------------------------------------------ */
/* Variables                                                            */
/* ------------------------------------------------------------------ */

/**
 * Folds a `variable[]` into the accumulating collection scope.
 *
 * ⚠️ **First-seen wins, and a conflict warns.** The collection's own variables
 * are folded first, so a folder cannot quietly shadow the collection-level
 * value a user is looking at in the UI. Last-wins would have been the other
 * defensible rule; what is *not* defensible is resolving it silently, because
 * the loser is invisible — we have no folder-scoped storage to put it in.
 */
function foldVariables(
  source: unknown,
  into: Map<string, KeyValueEntry>,
  path: string,
  warnings: ImportWarning[],
): void {
  for (const row of asArray(source)) {
    if (!isPlainObject(row)) continue;
    const key = asString(row.key);
    if (key === '') continue;

    const entry: KeyValueEntry = {
      key,
      value: asString(row.value),
      enabled: enabledFrom(row.disabled),
    };

    const existing = into.get(key);
    if (existing) {
      if (existing.value !== entry.value) {
        warnings.push({
          kind: 'variable-conflict',
          path,
          message: `Variable "${key}" is defined more than once with different values. The first one ("${existing.value}") was kept.`,
        });
      }
      continue;
    }
    into.set(key, entry);
  }
}

/* ------------------------------------------------------------------ */
/* The walk                                                             */
/* ------------------------------------------------------------------ */

/** `A / B / C` — the names the user sees in Postman's sidebar, not a pointer. */
function joinPath(ancestors: string[], name: string): string {
  return [...ancestors, name].join(' / ');
}

function isItemGroup(item: PostmanItem): boolean {
  return Array.isArray(item.item);
}

export function mapPostmanCollection(source: unknown): MappedImport {
  const warnings: ImportWarning[] = [];
  const document = isPlainObject(source) ? source : {};
  const info = isPlainObject(document.info) ? document.info : {};

  const collectionId = randomUUID();
  const collectionName = truncate(
    asString(info.name, 'Imported collection').trim() || 'Imported collection',
    COLLECTION_NAME_MAX_LENGTH,
  );

  const folders: MappedFolder[] = [];
  const requests: MappedRequest[] = [];
  const variables = new Map<string, KeyValueEntry>();

  // Collection scope first: it is the one a user can see and edit afterwards,
  // so it must win any conflict with a folder's — see `foldVariables`.
  foldVariables(document.variable, variables, collectionName, warnings);

  const collectionAuth = mapAuth(document.auth, collectionName, warnings);

  if (hasScripts(document.event)) {
    warnings.push({
      kind: 'collection-script-dropped',
      path: collectionName,
      message:
        'The collection has its own pre-request or test scripts. Only request-level scripts are imported, so these were dropped.',
    });
  }

  /** Counted across the whole document and reported once — see below. */
  let exampleCount = 0;

  const walk = (
    items: unknown,
    parentFolderId: string | null,
    depth: number,
    ancestors: string[],
  ): void => {
    const rows = asArray(items).filter(isPlainObject) as PostmanItem[];

    rows.forEach((item, index) => {
      // ⚠️ Position is computed, never queried: every sibling set here is brand
      // new. This is exactly the sequence `appendPosition` would produce.
      const position = (index + 1) * POSITION_GAP;

      if (isItemGroup(item)) {
        const name = truncate(
          asString(item.name, '').trim() || 'Untitled folder',
          COLLECTION_NAME_MAX_LENGTH,
        );
        const path = joinPath(ancestors, name);
        const id = randomUUID();

        folders.push({
          id,
          collectionId,
          parentFolderId,
          name,
          position,
          depth,
        });

        // ⚠️ A folder's own auth is **dropped, not flattened onto its
        // requests**. Flattening would copy one credential into N rows, so
        // rotating it later means editing N requests and missing one — and it
        // would erase the author's intent, which was precisely "inherit".
        // The requests below stay `inherit`, which is honest about where the
        // credential was meant to come from even though nothing inherits yet.
        if (mapAuth(item.auth, path, []) !== 'absent') {
          warnings.push({
            kind: 'folder-auth-dropped',
            path,
            message:
              'This folder defines its own auth. Folder-level auth is not supported, so it was dropped and its requests still inherit.',
          });
        }

        if (asArray(item.variable).length > 0) {
          warnings.push({
            kind: 'folder-variables-merged',
            path,
            message:
              "This folder's variables were merged into the collection's, since variables are collection-scoped here.",
          });
          foldVariables(item.variable, variables, path, warnings);
        }

        if (hasScripts(item.event)) {
          warnings.push({
            kind: 'collection-script-dropped',
            path,
            message:
              'This folder has its own pre-request or test scripts. Only request-level scripts are imported, so these were dropped.',
          });
        }

        walk(item.item, id, depth + 1, [...ancestors, name]);
        return;
      }

      /* A request item. */
      const name = truncate(
        asString(item.name, '').trim() || 'Untitled request',
        REQUEST_NAME_MAX_LENGTH,
      );
      const path = joinPath(ancestors, name);
      const request = isPlainObject(item.request) ? item.request : {};

      const rawMethod = asString(request.method, 'GET').toUpperCase();
      let method: HttpMethod = 'GET';
      if (HTTP_METHODS.includes(rawMethod as HttpMethod)) {
        method = rawMethod as HttpMethod;
      } else {
        // ⚠️ Coerced rather than dropped. The method is one field of a request
        // whose URL, headers and body are all still worth having, and a CHECK
        // constraint on the column means an unknown verb cannot be stored at
        // all. GET is the safe coercion: it is the one verb nobody expects to
        // change server state if the user presses Send without reading.
        warnings.push({
          kind: 'unsupported-method',
          path,
          message: `HTTP method "${asString(request.method)}" is not supported. This request was imported as GET.`,
        });
      }

      const url = postmanUrlToText(request.url);

      if (
        isPlainObject(request.url) &&
        asArray(request.url.variable).length > 0
      ) {
        // ⚠️ Left literal in the URL — `/users/:id` stays `/users/:id`. We have
        // no path-variable storage, and rewriting them to `{{id}}` would put a
        // name into the *variable* namespace that nothing defines, turning a
        // visible `:id` into an unresolved-variable warning at send time.
        warnings.push({
          kind: 'path-variables',
          path,
          message:
            'This URL uses :path variables. They were kept literally in the URL — fill them in or replace them with {{variables}}.',
        });
      }

      const exampleCountHere = asArray(item.response).length;
      exampleCount += exampleCountHere;

      const auth = mapAuth(request.auth, path, warnings);

      requests.push({
        id: randomUUID(),
        collectionId,
        folderId: parentFolderId,
        name,
        method,
        url,
        description:
          asDescription(request.description) ?? asDescription(item.description),
        headers: mapHeaders(request.header),
        queryParams: disabledQueryRows(request.url),
        body: mapBody(request.body, path, warnings),
        // Absent auth means inherit, in Postman and here — see `mapAuth`.
        auth: auth === 'absent' ? { type: 'inherit' } : auth,
        scripts: mapScripts(item.event),
        position,
      });
    });
  };

  walk(document.item, null, 0, [collectionName]);

  if (exampleCount > 0) {
    // ⚠️ **One aggregate warning, not one per example.** A collection with 300
    // saved examples would otherwise produce 300 warnings and bury the ones
    // that describe something the user has to act on.
    warnings.push({
      kind: 'examples-dropped',
      path: collectionName,
      message: `${exampleCount} saved example response${exampleCount === 1 ? ' was' : 's were'} dropped. Raven stores real send history instead.`,
    });
  }

  return {
    collection: {
      id: collectionId,
      name: collectionName,
      description: asDescription(info.description),
      // A collection has no parent, so an absent auth is `none`, not `inherit`.
      auth:
        collectionAuth === 'absent' || collectionAuth.type === 'inherit'
          ? { type: 'none' }
          : collectionAuth,
      variables: [...variables.values()],
    },
    folders,
    requests,
    warnings,
  };
}
