import {
  placeholderPattern,
  variableName,
  type KeyValueEntry,
  type RequestAuth,
  type RequestBody,
  type ResolvedVariable,
  type SendWarning,
} from '@raven/contracts';

/**
 * `{{var}}` substitution — pure. No Nest, no DB, no I/O, so every rule below is
 * a unit test rather than an integration one.
 *
 * **One pass, no rescanning.** A substituted value that itself contains
 * `{{x}}` is emitted literally and never re-expanded. That single property
 * closes recursion, expansion bombs and variable-injection-through-a-variable
 * in one stroke, and it is far cheaper to reason about than an escape
 * character. The cost is real and is documented rather than hidden: a literal
 * `{{token}}` in a body is unrepresentable. That is an accepted limitation of
 * this slice, not an oversight.
 *
 * ⚠️ An unresolved `{{name}}` is left **in place, literally**, and warns.
 * Substituting the empty string is the worst of the three options —
 * `{{baseUrl}}/users` would become `/users`, a request against a *different
 * host* that may well succeed. Failing hard is the second worst: a literal
 * `{{` anywhere in a body would make the request unsendable. In practice the
 * URL case self-enforces, because `https://{{host}}/x` fails `new URL()` and
 * comes back as `kind: 'invalid-url'` — the loud failure, exactly where it
 * matters.
 */

/**
 * ⚠️ The syntax and the merge live in **`@raven/contracts`**, not here.
 * The request editor highlights `{{var}}` chips and offers autocomplete from
 * the same regex and the same lookup table this file substitutes with — a
 * second copy on the client is how a chip comes to say "not defined" for a name
 * the send path resolves perfectly well. Same doctrine as `passwordProblem()`.
 *
 * They are re-exported so that this module stays the one import site for the
 * send path, and so that `interpolate.spec.ts` keeps covering them from here.
 */
export { buildVariables } from '@raven/contracts';
export type { VariableScope, ResolvedVariable } from '@raven/contracts';

/** Where a placeholder was found, for the warning text. */
export type InterpolationSite = string;

/** Accumulates warnings and secret values across one request's many strings. */
export class InterpolationContext {
  /** Deduplicated by kind + message — one warning per (name, site) pair. */
  private readonly seen = new Set<string>();
  private readonly collected: SendWarning[] = [];

  /**
   * Every substituted value whose source variable was marked `secret`.
   * `redact.ts` masks these in anything we **store**.
   */
  readonly secretValues = new Set<string>();

  constructor(private readonly variables: Map<string, ResolvedVariable>) {}

  get warnings(): SendWarning[] {
    return this.collected;
  }

  /** Adds a warning that is not about a variable (auth override, and so on). */
  warn(warning: SendWarning): void {
    // \0 rather than a raw NUL byte, which is what used to be here: a literal
    // control character makes git treat this whole file as binary, so every
    // diff on it came back as "Bin 7799 -> 7219 bytes" and grep skipped it.
    const dedupeKey = `${warning.kind}\0${warning.message}`;
    if (this.seen.has(dedupeKey)) return;
    this.seen.add(dedupeKey);
    this.collected.push(warning);
  }

  /**
   * One pass over `input`. Unknown names are left in place and warned about;
   * substituted text is **never** rescanned.
   */
  apply(input: string, site: InterpolationSite): string {
    if (!input) return input;
    return input.replace(placeholderPattern(), (whole, rawName: string) => {
      const name = variableName(rawName);
      const found = this.variables.get(name);
      if (!found) {
        this.warn({
          kind: 'unresolved-variable',
          message: `Variable "${name}" is not defined (in ${site})`,
        });
        return whole;
      }
      if (found.secret && found.value !== '') {
        this.secretValues.add(found.value);
      }
      return found.value;
    });
  }
}

/** The subset of a request the send path actually transmits. */
export interface SendableRequest {
  url: string;
  headers: KeyValueEntry[];
  queryParams: KeyValueEntry[];
  body: RequestBody;
  auth: RequestAuth;
}

export interface InterpolatedRequest {
  resolved: SendableRequest;
  warnings: SendWarning[];
  secretValues: Set<string>;
}

/** Enabled rows only; both key and value are interpolated. */
function applyEntries(
  entries: KeyValueEntry[],
  context: InterpolationContext,
  site: (key: string) => string,
): KeyValueEntry[] {
  return entries
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      key: context.apply(entry.key, site(entry.key)),
      value: context.apply(entry.value, site(entry.key)),
      enabled: true,
    }));
}

function applyBody(
  body: RequestBody,
  context: InterpolationContext,
): RequestBody {
  switch (body.mode) {
    case 'none':
      return body;
    case 'raw':
    case 'json':
      return { mode: body.mode, text: context.apply(body.text, 'body') };
    case 'form-urlencoded':
      return {
        mode: 'form-urlencoded',
        entries: applyEntries(
          body.entries,
          context,
          (key) => `body field "${key}"`,
        ),
      };
    case 'xml':
      // Text is text. The mode differs from `raw` only in the Content-Type the
      // send path defaults to and in what the editor highlights.
      return { mode: 'xml', text: context.apply(body.text, 'body') };
    case 'graphql':
      return {
        mode: 'graphql',
        query: context.apply(body.query, 'GraphQL query'),
        variables: context.apply(body.variables, 'GraphQL variables'),
      };
    case 'form-data':
      return {
        mode: 'form-data',
        // ⚠️ A `file` row's `value` is a **path on the author's machine**, not
        // content, so interpolating it would produce a different path that is
        // just as unreadable — and this body is not sent at all. Text rows are
        // interpolated so the stored shape stays consistent with every other
        // mode if sending ever lands.
        entries: body.entries
          .filter((entry) => entry.enabled)
          .map((entry) =>
            entry.type === 'file'
              ? entry
              : {
                  ...entry,
                  key: context.apply(entry.key, `body field "${entry.key}"`),
                  value: context.apply(
                    entry.value,
                    `body field "${entry.key}"`,
                  ),
                },
          ),
      };
    case 'binary':
      // A path, like a file row above. Nothing to substitute into.
      return body;
  }
}

/**
 * `inherit` resolves to `none`, and **no warning is emitted**.
 *
 * There is no collection-level auth to inherit from, so the honest behaviour is
 * to send nothing. `inherit` stays a distinct choice in the editor because it
 * is the reserved spelling for collection auth when that lands — the seam stays
 * visible. A warning would be wrong here specifically because
 * `RequestsService.create` defaults every new request to `{ type: 'inherit' }`,
 * so it would fire on essentially everything and train users to ignore the
 * warnings strip.
 */
function applyAuth(
  auth: RequestAuth,
  context: InterpolationContext,
): RequestAuth {
  switch (auth.type) {
    case 'inherit':
    case 'none':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: context.apply(auth.token, 'auth token') };
    case 'basic':
      return {
        type: 'basic',
        username: context.apply(auth.username, 'auth username'),
        password: context.apply(auth.password, 'auth password'),
      };
    case 'apiKey':
      return {
        type: 'apiKey',
        key: context.apply(auth.key, 'auth API key name'),
        value: context.apply(auth.value, 'auth API key value'),
        in: auth.in,
      };
    case 'unsupported':
      // ⚠️ Passed through **uninterpolated**. Nothing is ever sent from these
      // params, so substituting into them could only leak an environment
      // secret into `redact.ts`'s blast radius for no benefit — and a value
      // marked `secret` gets added to `secretValues` by the very act of
      // resolving it. The warning is raised in `execution.service.ts`, where
      // the auth is applied, not here.
      return auth;
  }
}

/**
 * Interpolates every transmitted field of a request.
 *
 * The URL is done first because it is the field whose failure is loudest: a
 * placeholder that survives here fails `new URL()` downstream and the send ends
 * as `invalid-url`.
 */
export function interpolateRequest(
  request: SendableRequest,
  variables: Map<string, ResolvedVariable>,
): InterpolatedRequest {
  const context = new InterpolationContext(variables);

  const resolved: SendableRequest = {
    url: context.apply(request.url, 'url'),
    queryParams: applyEntries(
      request.queryParams,
      context,
      (key) => `query "${key}"`,
    ),
    headers: applyEntries(request.headers, context, (key) => `header "${key}"`),
    body: applyBody(request.body, context),
    auth: applyAuth(request.auth, context),
  };

  return {
    resolved,
    warnings: context.warnings,
    secretValues: context.secretValues,
  };
}
