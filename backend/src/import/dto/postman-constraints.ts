import { IMPORT_MAX_ITEMS, type ImportCollectionInput } from '@raven/contracts';
import {
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { SUPPORTED_SCHEMA_PATTERN } from '../postman-types';

/**
 * Structural validation of a Postman document, as **one constraint per kind**.
 *
 * This is the `json-constraints.ts` precedent applied to a much larger opaque
 * object, and the reason is the same one, only louder: the global pipe runs
 * with `whitelist: true`, which strips every key a decorated class does not
 * declare. Modelling a Postman document as nested DTO classes would therefore
 * **silently delete most of the file** before the mapper ever saw it — the
 * import would report success and produce an empty collection. A plain
 * `unknown` checked by a constraint passes through untouched.
 *
 * ⚠️ The division of labour with the mapper is deliberate and narrow. This
 * checks only what must be true for the file to be *the right kind of file*;
 * everything else is the mapper's warning, not a 400. Concretely: a document
 * whose `info.schema` is a v1 collection is a mistake the user must fix, while
 * a request with a malformed header is data we can still import.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Folders + requests, counted recursively.
 *
 * ⚠️ Counted **before** anything is mapped, and short-circuited: the byte cap
 * does not bound this on its own (a small file can describe a deep tree), and
 * the whole point is to refuse the work rather than to discover the size
 * halfway through building it.
 */
export function countItems(items: unknown, limit: number): number {
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (const item of items) {
    total += 1;
    if (total > limit) return total;
    if (isPlainObject(item) && Array.isArray(item.item)) {
      total += countItems(item.item, limit - total);
      if (total > limit) return total;
    }
  }
  return total;
}

export function postmanCollectionProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'must be a Postman collection object';

  const info = value.info;
  if (!isPlainObject(info)) return 'is missing its "info" block';

  const schema = typeof info.schema === 'string' ? info.schema : '';
  if (!SUPPORTED_SCHEMA_PATTERN.test(schema)) {
    return schema === ''
      ? 'is missing "info.schema" — export it from Postman as Collection v2.1'
      : `declares schema "${schema}", which is not a Postman Collection v2.0 or v2.1 export`;
  }

  if (typeof info.name !== 'string' || info.name.trim() === '') {
    return 'is missing "info.name"';
  }

  if (!Array.isArray(value.item)) return 'is missing its "item" array';

  if (countItems(value.item, IMPORT_MAX_ITEMS) > IMPORT_MAX_ITEMS) {
    return `contains more than ${IMPORT_MAX_ITEMS} folders and requests`;
  }

  return null;
}

/**
 * ⚠️ One constraint, one message — the rule the password policy set. A pile of
 * per-field validators here would answer a wrong-file mistake with six
 * overlapping complaints about a document the user never hand-wrote.
 */
@ValidatorConstraint({ name: 'postmanCollection' })
export class PostmanCollectionConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return postmanCollectionProblem(value) === null;
  }

  defaultMessage(args?: ValidationArguments): string {
    return `data ${postmanCollectionProblem(args?.value) ?? 'is not a valid Postman collection'}`;
  }
}

export function postmanEnvironmentProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'must be a Postman environment object';

  // `values` is the only load-bearing key: the name has a fallback and the
  // scope marker is optional (its absence just means "not a globals export").
  if (!Array.isArray(value.values)) return 'is missing its "values" array';
  const values = value.values as unknown[];

  const keyless = values.some(
    (row) => !isPlainObject(row) || typeof row.key !== 'string',
  );
  if (keyless) {
    return 'has a variable without a string "key"';
  }

  if (values.length > IMPORT_MAX_ITEMS) {
    return `contains more than ${IMPORT_MAX_ITEMS} variables`;
  }

  return null;
}

@ValidatorConstraint({ name: 'postmanEnvironment' })
export class PostmanEnvironmentConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return postmanEnvironmentProblem(value) === null;
  }

  defaultMessage(args?: ValidationArguments): string {
    return `data ${postmanEnvironmentProblem(args?.value) ?? 'is not a valid Postman environment'}`;
  }
}

/** Narrowing helper so the service reads a checked document, not `unknown`. */
export type CheckedCollectionInput = ImportCollectionInput;
