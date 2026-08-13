import { BadRequestException } from '@nestjs/common';
import { ApiErrorCode, type ApiErrorDetail } from '@postman-clone/contracts';
import type { ValidationError } from 'class-validator';

/**
 * Flattens class-validator's nested tree into a flat list of dotted paths, so
 * `address.postcode` reads as one entry rather than a nested object the client
 * has to walk.
 */
function flatten(errors: ValidationError[], parent = ''): ApiErrorDetail[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({
      field,
      message,
    }));
    const nested = error.children?.length ? flatten(error.children, field) : [];
    return [...own, ...nested];
  });
}

/**
 * Makes ValidationPipe throw something the error filter can render as
 * VALIDATION_FAILED with per-field detail, instead of Nest's default array of
 * bare strings.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const details = flatten(errors);
  return new BadRequestException({
    code: ApiErrorCode.VALIDATION_FAILED,
    message: 'Request validation failed',
    details,
  });
}
