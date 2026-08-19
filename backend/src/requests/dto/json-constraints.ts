import {
  REQUEST_AUTH_TYPES,
  REQUEST_BODY_MODES,
  type RequestAuthType,
  type RequestBodyMode,
} from '@postman-clone/contracts';
import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

/**
 * The `jsonb` columns are validated by **one custom constraint each**, never by
 * `@ValidateNested()` + `@Type()`. Two reasons, both real rather than stylistic:
 *
 * 1. The global pipe runs with `whitelist: true`, which **strips any key a
 *    decorated nested class does not declare**. A union validated that way
 *    would silently mangle a body the client sent — you would save a request
 *    and get back something subtly different. A plain object checked by a
 *    constraint passes through untouched.
 * 2. A union run through `@ValidateNested` produces a pile of overlapping
 *    messages, one per branch that failed. This is the precedent the password
 *    rule already set: one constraint, one message.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** A `KeyValueEntry[]`: rows of the headers and query-params editors. */
export function isKeyValueEntries(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isPlainObject(entry) &&
        isString(entry.key) &&
        isString(entry.value) &&
        typeof entry.enabled === 'boolean',
    )
  );
}

@ValidatorConstraint({ name: 'keyValueEntries' })
export class KeyValueEntriesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isKeyValueEntries(value);
  }

  defaultMessage(): string {
    return 'must be an array of { key: string, value: string, enabled: boolean }';
  }
}

export function isRequestBody(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!REQUEST_BODY_MODES.includes(value.mode as RequestBodyMode)) return false;

  switch (value.mode) {
    case 'none':
      return true;
    case 'raw':
    case 'json':
      return isString(value.text);
    case 'form-urlencoded':
      return isKeyValueEntries(value.entries);
    default:
      return false;
  }
}

@ValidatorConstraint({ name: 'requestBody' })
export class RequestBodyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isRequestBody(value);
  }

  defaultMessage(): string {
    return `body must be an object whose mode is one of: ${REQUEST_BODY_MODES.join(', ')}, with the fields that mode requires`;
  }
}

export function isRequestAuth(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!REQUEST_AUTH_TYPES.includes(value.type as RequestAuthType)) return false;

  switch (value.type) {
    case 'inherit':
    case 'none':
      return true;
    case 'bearer':
      return isString(value.token);
    case 'basic':
      return isString(value.username) && isString(value.password);
    case 'apiKey':
      return (
        isString(value.key) &&
        isString(value.value) &&
        (value.in === 'header' || value.in === 'query')
      );
    default:
      return false;
  }
}

@ValidatorConstraint({ name: 'requestAuth' })
export class RequestAuthConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isRequestAuth(value);
  }

  defaultMessage(): string {
    return `auth must be an object whose type is one of: ${REQUEST_AUTH_TYPES.join(', ')}, with the fields that type requires`;
  }
}

export function isEnvironmentVariables(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (variable) =>
        isPlainObject(variable) &&
        isString(variable.key) &&
        isString(variable.value) &&
        typeof variable.enabled === 'boolean' &&
        (variable.secret === undefined || typeof variable.secret === 'boolean'),
    )
  );
}

@ValidatorConstraint({ name: 'environmentVariables' })
export class EnvironmentVariablesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isEnvironmentVariables(value);
  }

  defaultMessage(): string {
    return 'must be an array of { key: string, value: string, enabled: boolean, secret?: boolean }';
  }
}
