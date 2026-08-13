import { randomUUID } from 'node:crypto';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  type ApiError,
  ApiErrorCode,
  type ApiErrorDetail,
} from '@postman-clone/contracts';
import type { Request, Response } from 'express';

/** Default code for a status that nothing more specific claimed. */
const STATUS_TO_CODE: Record<number, ApiErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ApiErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ApiErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ApiErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ApiErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ApiErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ApiErrorCode.RATE_LIMITED,
};

interface StructuredPayload {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

/**
 * The single exit for every failure. Catches everything — Nest exceptions,
 * our ApiException, and anything unexpected — and renders the one error shape
 * declared in @postman-clone/contracts.
 *
 * The important property is the last branch: an unexpected throw becomes a
 * generic INTERNAL message. Stack traces, driver errors and failing SQL are
 * logged server-side and never travel to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Reuse an inbound id when a proxy or client supplied one, so a single
    // request stays traceable across hops.
    const inbound = request.header('x-request-id');
    const requestId = inbound && inbound.length <= 200 ? inbound : randomUUID();

    const { status, code, message, details } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} [${requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiError = {
      error: {
        code,
        message,
        ...(details && details.length > 0 ? { details } : {}),
        requestId,
        timestamp: new Date().toISOString(),
        path: request.originalUrl,
      },
    };

    response.setHeader('x-request-id', requestId);
    response.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetail[];
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      // ApiException and validationExceptionFactory both put a structured
      // object here; Nest's built-ins put a string or {message, statusCode}.
      if (typeof payload === 'object' && payload !== null) {
        const structured = payload as StructuredPayload;
        const code = this.isKnownCode(structured.code)
          ? structured.code
          : (STATUS_TO_CODE[status] ?? ApiErrorCode.INTERNAL);

        return {
          status,
          code,
          message: this.toMessage(structured.message, exception.message),
          details: Array.isArray(structured.details)
            ? (structured.details as ApiErrorDetail[])
            : undefined,
        };
      }

      return {
        status,
        code: STATUS_TO_CODE[status] ?? ApiErrorCode.INTERNAL,
        message: typeof payload === 'string' ? payload : exception.message,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ApiErrorCode.INTERNAL,
      // Deliberately fixed. Whatever actually went wrong is in the log.
      message: 'An unexpected error occurred.',
    };
  }

  private isKnownCode(value: unknown): value is ApiErrorCode {
    return (
      typeof value === 'string' &&
      Object.values(ApiErrorCode).includes(value as ApiErrorCode)
    );
  }

  private toMessage(value: unknown, fallback: string): string {
    if (typeof value === 'string') return value;
    // Nest's default ValidationPipe shape is an array of strings.
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      return value.join('; ');
    }
    return fallback;
  }
}
