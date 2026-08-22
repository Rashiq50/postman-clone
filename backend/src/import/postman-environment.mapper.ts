import {
  ENVIRONMENT_NAME_MAX_LENGTH,
  type EnvironmentVariable,
  type ImportWarning,
} from '@raven/contracts';

/**
 * A Postman environment (or globals) export → one of ours.
 *
 * Total and defensive for the same reason as the collection mapper: the DTO has
 * confirmed `values` is an array of objects with a string `key`, and everything
 * past that is a stranger's file.
 *
 * ⚠️ **A Postman *globals* export is accepted and imported as an ordinary
 * environment**, with a warning. The file is structurally identical — the only
 * difference is `_postman_variable_scope`, and Postman's globals are a single
 * unnamed always-on scope, which this app deliberately does not have. Refusing
 * the file would send the user away to hand-copy variables that we can place
 * perfectly well; importing it silently would let someone believe their globals
 * are still global. So: import it, name it, and say what happened.
 */

export interface MappedEnvironment {
  name: string;
  variables: EnvironmentVariable[];
}

export interface MappedEnvironmentImport {
  environment: MappedEnvironment;
  warnings: ImportWarning[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** See the note on the collection mapper's `asString`: Postman writes numbers. */
function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

export function mapPostmanEnvironment(
  source: unknown,
): MappedEnvironmentImport {
  const warnings: ImportWarning[] = [];
  const document = isPlainObject(source) ? source : {};

  const isGlobals = asString(document._postman_variable_scope) === 'globals';

  const name = (() => {
    const raw = asString(document.name).trim();
    if (raw !== '') return raw.slice(0, ENVIRONMENT_NAME_MAX_LENGTH);
    return isGlobals ? 'Postman globals' : 'Imported environment';
  })();

  if (isGlobals) {
    warnings.push({
      kind: 'globals-as-environment',
      path: name,
      message:
        'This is a Postman globals export. It was imported as an ordinary environment — select it to use its variables.',
    });
  }

  const variables: EnvironmentVariable[] = (
    Array.isArray(document.values) ? document.values : []
  )
    .filter(isPlainObject)
    .map((row) => ({
      key: asString(row.key),
      // `value` is genuinely optional in an export — a variable with a current
      // value but no initial one exports as `{ key, enabled }`.
      value: asString(row.value),
      // Postman's flag is `enabled`, not `disabled`, and absent means on.
      enabled: row.enabled !== false,
      // ⚠️ A display hint only. The value is stored in plaintext exactly like
      // every other one; `secret` is `undefined` rather than `false` when it
      // does not apply, matching `EnvironmentVariable`'s optional field so the
      // stored jsonb stays the shape the editor writes.
      ...(asString(row.type) === 'secret' ? { secret: true } : {}),
    }))
    .filter((variable) => variable.key !== '');

  return { environment: { name, variables }, warnings };
}
