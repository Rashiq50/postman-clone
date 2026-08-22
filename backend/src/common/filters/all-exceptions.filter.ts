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
} from '@raven/contracts';
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

/**
 * The body parser throws plain `Error`s, not `HttpException`s.
 *
 * ⚠️ Without this they fall to the catch-all below and a body one byte over
 * the limit answers **500 INTERNAL** — telling the caller our server broke
 * when in fact their file is too big and the fix is entirely theirs. Both
 * shapes are the client's fault and neither is a server fault:
 *
 * - `entity.too.large` → **413**, which the import dialog reads to say "that
 *   file is too big" rather than "something went wrong";
 * - `entity.parse.failed` → **400**, a truncated or hand-edited JSON file.
 *
 * ⚠️ **Neither gets a new `ApiErrorCode`.** `BAD_REQUEST` already means exactly
 * "malformed request that is not field-level validation", and the HTTP status
 * carries the distinction. Adding `PAYLOAD_TOO_LARGE` would be a code the
 * client branches on to say what the status already said.
 */
interface BodyParserError {
  type?: unknown;
  status?: unknown;
}

function bodyParserFailure(
  exception: unknown,
): { status: HttpStatus; message: string } | null {
  if (!(exception instanceof Error)) return null;
  const { type, status } = exception as unknown as BodyParserError;

  if (type === 'entity.too.large') {
    return {
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      message: 'The request body is larger than this endpoint accepts.',
    };
  }
  if (type === 'entity.parse.failed') {
    return {
      status: HttpStatus.BAD_REQUEST,
      message: 'The request body is not valid JSON.',
    };
  }
  // Anything else the parser rejects (a bad charset, an unsupported encoding)
  // is still the caller's request rather than our fault — but only trust the
  // status it carries, never its message, which can quote the body back.
  if (typeof type === 'string' && typeof status === 'number' && status < 500) {
    return {
      status: status,
      message: 'The request body could not be read.',
    };
  }
  return null;
}

interface StructuredPayload {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

/**
 * The single exit for every failure. Catches everything — Nest exceptions,
 * our ApiException, and anything unexpected — and renders the one error shape
 * declared in @raven/contracts.
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
    const parserFailure = bodyParserFailure(exception);
    if (parserFailure) {
      return {
        status: parserFailure.status,
        code: ApiErrorCode.BAD_REQUEST,
        message: parserFailure.message,
      };
    }

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
