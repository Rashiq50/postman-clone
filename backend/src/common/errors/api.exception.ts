import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiErrorCode, type ApiErrorDetail } from '@raven/contracts';

interface ApiExceptionPayload {
  code: ApiErrorCode;
  message: string;
  details?: ApiErrorDetail[];
}

/**
 * Throw this when the error code matters to the client.
 *
 * Nest's built-in exceptions (NotFoundException, ForbiddenException, …) still
 * work and are mapped to sensible codes by AllExceptionsFilter — reach for this
 * only when the default mapping is not specific enough, e.g. a 409 that a
 * client must distinguish from other 409s.
 */
export class ApiException extends HttpException {
  constructor(status: HttpStatus, payload: ApiExceptionPayload) {
    super(payload, status);
  }

  get payload(): ApiExceptionPayload {
    return this.getResponse() as ApiExceptionPayload;
  }

  static conflict(message: string, details?: ApiErrorDetail[]): ApiException {
    return new ApiException(HttpStatus.CONFLICT, {
      code: ApiErrorCode.CONFLICT,
      message,
      details,
    });
  }

  static forbidden(message: string): ApiException {
    return new ApiException(HttpStatus.FORBIDDEN, {
      code: ApiErrorCode.FORBIDDEN,
      message,
    });
  }

  static unauthenticated(message: string): ApiException {
    return new ApiException(HttpStatus.UNAUTHORIZED, {
      code: ApiErrorCode.UNAUTHENTICATED,
      message,
    });
  }
}
