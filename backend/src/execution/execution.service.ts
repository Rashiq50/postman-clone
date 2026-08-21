import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  EnvironmentVariable,
  RequestAuth,
  ResponseHeader,
  SendRequestInput,
  SendResult,
  SendWarning,
} from '@raven/contracts';
import { Repository } from 'typeorm';
import { explainDenial } from '../workspaces/scope-denial';
import {
  READ_ROLES,
  REQUEST_SCOPE,
  scopeParams,
  scopedWhere,
} from '../workspaces/workspace-scope';
import { RequestEntity } from '../requests/entities/request.entity';
import { ExecutionsService } from './executions.service';
import {
  BODYLESS_METHODS,
  HeaderValidationError,
  sendHttp,
  validateHeaders,
} from './http-client';
import {
  buildVariables,
  interpolateRequest,
  type SendableRequest,
} from './interpolate';
import { SEND_OPTIONS, type SendOptions } from './send-options';

/** What the caller's active environment resolves to, plus its id. */
interface ResolvedEnvironment {
  id: string | null;
  variables: EnvironmentVariable[];
}

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    @InjectRepository(RequestEntity)
    private readonly requests: Repository<RequestEntity>,
    private readonly executions: ExecutionsService,
    @Inject(SEND_OPTIONS) private readonly options: SendOptions,
  ) {
    if (this.options.allowPrivateNetwork) {
      // Logged once at boot so nobody ships it by accident.
      this.logger.warn(
        'SEND_ALLOW_PRIVATE_NETWORK is enabled: sends may reach loopback, ' +
          'private and link-local addresses, including the cloud metadata ' +
          'endpoint. Never enable this in production.',
      );
    }
  }

  async send(
    userId: string,
    requestId: string,
    input: SendRequestInput,
  ): Promise<SendResult> {
    const stored = await this.loadRequest(userId, requestId);
    const environment = await this.resolveEnvironment(
      userId,
      requestId,
      input.environmentId,
    );

    // `{ ...stored, ...draft }`: the draft may replace what is transmitted and
    // nothing else. It carries no parent ids, so it cannot reparent anything
    // and the stored row remains the authorization anchor.
    const draft = input.draft ?? {};
    const usedDraft = Object.keys(draft).length > 0;
    const merged: SendableRequest = {
      url: draft.url ?? stored.url,
      headers: draft.headers ?? stored.headers,
      queryParams: draft.queryParams ?? stored.queryParams,
      body: draft.body ?? stored.body,
      auth: draft.auth ?? stored.auth,
    };
    const method = draft.method ?? stored.method;

    // An ordered list of scopes, even though only one exists today — see
    // `buildVariables`. Collection- and request-level variables later cost a
    // merge here rather than a rewrite.
    const variables = buildVariables([
      { name: 'environment', variables: environment.variables },
    ]);
    const { resolved, warnings, secretValues } = interpolateRequest(
      merged,
      variables,
    );

    const startedAt = new Date().toISOString();
    const result = await this.perform(method, resolved, warnings);

    const sendResult: SendResult = {
      executionId: null,
      requestId,
      url: result.finalUrl,
      method,
      environmentId: environment.id,
      usedDraft,
      redirects: result.redirects,
      warnings: [...warnings, ...result.warnings],
      timing: result.timing,
      startedAt,
      result: result.result,
    };

    // ⚠️ **A failed insert must never turn a successful send into an error.**
    // The request already left the building; a 500 here would tell the user
    // their send failed when it did not, and would invite a retry that fires
    // the upstream call a second time.
    try {
      sendResult.executionId = await this.executions.record({
        requestId,
        userId,
        result: sendResult,
        secretValues,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record execution for request ${requestId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return sendResult;
  }

  /**
   * Assembles the wire request and runs it.
   *
   * Everything that can fail before a socket opens fails here, as a
   * `SendFailure` inside a 200 — never as an exception of ours.
   */
  private async perform(
    method: SendResult['method'],
    resolved: SendableRequest,
    warnings: SendWarning[],
  ): Promise<Awaited<ReturnType<typeof sendHttp>>> {
    const emptyTiming = {
      totalMs: 0,
      dnsMs: null,
      connectMs: null,
      tlsMs: null,
      firstByteMs: null,
    };

    let url: URL;
    try {
      url = new URL(resolved.url);
    } catch {
      return {
        finalUrl: resolved.url,
        redirects: [],
        warnings: [],
        timing: emptyTiming,
        result: {
          outcome: 'failure',
          kind: 'invalid-url',
          message: `"${resolved.url}" is not a valid URL. An unresolved {{variable}} in the URL is the usual cause.`,
        },
      };
    }

    // Appended to whatever the URL already carries, duplicates preserved —
    // Postman's behaviour, and the only one that can express `?tag=a&tag=b`.
    for (const entry of resolved.queryParams) {
      if (entry.key === '') continue;
      url.searchParams.append(entry.key, entry.value);
    }

    const headers: ResponseHeader[] = resolved.headers
      .filter((entry) => entry.key !== '')
      .map((entry) => ({ name: entry.key, value: entry.value }));

    applyAuth(resolved.auth, headers, url, warnings);

    const body = buildBody(resolved, headers);

    if (body && body.length > this.options.maxRequestBodyBytes) {
      return {
        finalUrl: url.toString(),
        redirects: [],
        warnings: [],
        timing: emptyTiming,
        result: {
          outcome: 'failure',
          kind: 'unknown',
          message: `The request body is larger than the ${this.options.maxRequestBodyBytes}-byte limit.`,
        },
      };
    }

    if (body && BODYLESS_METHODS.has(method)) {
      warnings.push({
        kind: 'body-on-bodyless-method',
        message: `${method} requests do not normally carry a body. It was sent anyway.`,
      });
    }

    // ⚠️ After interpolation, before the socket. `{{token}}` can carry
    // `x\r\nX-Admin: 1` straight out of an environment variable.
    try {
      validateHeaders(headers);
    } catch (error) {
      if (error instanceof HeaderValidationError) {
        return {
          finalUrl: url.toString(),
          redirects: [],
          warnings: [],
          timing: emptyTiming,
          result: {
            outcome: 'failure',
            kind: 'invalid-header',
            message: error.message,
          },
        };
      }
      throw error;
    }

    // ⚠️ A cap on *decompressed* bytes only works if we ask for none: a cap on
    // compressed bytes is not a cap, and a 5 MiB gzip is a gigabyte of RAM. A
    // user-set accept-encoding still wins — this is a testing tool.
    if (!headers.some((h) => h.name.toLowerCase() === 'accept-encoding')) {
      headers.push({ name: 'accept-encoding', value: 'identity' });
    }

    return sendHttp(
      { method, url: url.toString(), headers, body },
      this.options,
    );
  }

  /**
   * ⚠️ **Sending is a read-like act**, so this takes `READ_ROLES`.
   *
   * A VIEWER can already read the URL and the plaintext bearer token out of
   * `GET /requests/:id`, so refusing them Send leaks nothing and buys nothing.
   * The counter-argument — that a send consumes *our* egress and hits third
   * parties from our IP — is real, and it is answered by the SSRF policy and
   * the per-user throttle, not by the role table. Reversing this decision is
   * one constant.
   */
  private async loadRequest(
    userId: string,
    requestId: string,
  ): Promise<RequestEntity> {
    const row = await this.requests
      .createQueryBuilder('r')
      .where(`r."id" = :id AND ${scopedWhere(REQUEST_SCOPE, 'r')}`, {
        id: requestId,
        ...scopeParams(userId, READ_ROLES),
      })
      .getOne();

    if (!row) {
      await explainDenial(
        this.requests.manager,
        RequestEntity,
        REQUEST_SCOPE,
        userId,
        requestId,
      );
    }
    return row!;
  }

  /**
   * Resolves which environment's variables apply.
   *
   * ⚠️ **The environment must be re-scoped *and* confirmed to belong to the
   * request's own workspace.** Resolving it through `ENVIRONMENT_SCOPE` alone
   * is not enough: a member of two workspaces could otherwise inject workspace
   * B's variables — and so B's base URL and B's credentials — into a send from
   * workspace A. That is one predicate, and a miss is a 404 naming the
   * environment.
   *
   * An omitted `environmentId` means "the caller's active environment", read
   * from their `workspace_members` row **for the request's workspace**. A stale
   * id is impossible by construction: the column is `ON DELETE SET NULL`, so
   * the read answers a live environment or null, never a dangling reference.
   */
  private async resolveEnvironment(
    userId: string,
    requestId: string,
    environmentId: string | null | undefined,
  ): Promise<ResolvedEnvironment> {
    if (environmentId === null) return { id: null, variables: [] };

    if (environmentId === undefined) {
      const rows = await this.requests.manager.query<
        { variables: EnvironmentVariable[]; id: string }[]
      >(
        `SELECT e."id" AS "id", e."variables" AS "variables"
         FROM "requests" r
         JOIN "collections" c ON c."id" = r."collectionId"
         JOIN "workspace_members" m
           ON m."workspaceId" = c."workspaceId" AND m."userId" = $2
         JOIN "environments" e ON e."id" = m."activeEnvironmentId"
         WHERE r."id" = $1`,
        [requestId, userId],
      );

      const active = rows[0];
      return active
        ? { id: active.id, variables: active.variables }
        : { id: null, variables: [] };
    }

    const rows = await this.requests.manager.query<
      { variables: EnvironmentVariable[] }[]
    >(
      `SELECT e."variables" AS "variables"
       FROM "environments" e
       JOIN "collections" c ON c."workspaceId" = e."workspaceId"
       JOIN "requests" r ON r."collectionId" = c."id"
       JOIN "workspace_members" m
         ON m."workspaceId" = e."workspaceId"
        AND m."userId" = $3
        AND m."role" = ANY($4)
       WHERE e."id" = $1 AND r."id" = $2
       LIMIT 1`,
      [environmentId, requestId, userId, [...READ_ROLES]],
    );

    if (rows.length === 0) {
      throw new NotFoundException(
        `Environment with id "${environmentId}" not found in this request's workspace`,
      );
    }

    return { id: environmentId, variables: rows[0].variables };
  }
}

/**
 * Auth-derived headers are applied **after** user headers and overwrite a
 * same-named one, warning when they do. `apiKey` with `in: 'query'` appends a
 * query param under the same rule.
 */
function applyAuth(
  auth: RequestAuth,
  headers: ResponseHeader[],
  url: URL,
  warnings: SendWarning[],
): void {
  const set = (name: string, value: string) => {
    const existing = headers.findIndex(
      (header) => header.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing !== -1) {
      warnings.push({
        kind: 'header-overridden-by-auth',
        message: `Your "${headers[existing].name}" header was replaced by the value from the Auth tab.`,
      });
      headers.splice(existing, 1);
    }
    headers.push({ name, value });
  };

  switch (auth.type) {
    case 'inherit':
    case 'none':
      return;
    case 'bearer':
      set('Authorization', `Bearer ${auth.token}`);
      return;
    case 'basic':
      set(
        'Authorization',
        `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`,
      );
      return;
    case 'apiKey':
      if (auth.key === '') return;
      if (auth.in === 'header') set(auth.key, auth.value);
      else url.searchParams.set(auth.key, auth.value);
      return;
  }
}

/**
 * Serialises the body and sets its content type.
 *
 * `json` sends the **raw text without re-serialising** — the user's formatting,
 * and their deliberately malformed JSON, are both the point of a testing tool.
 * In every case a user-supplied `Content-Type` header wins.
 */
function buildBody(
  resolved: SendableRequest,
  headers: ResponseHeader[],
): Buffer | null {
  const hasContentType = headers.some(
    (header) => header.name.toLowerCase() === 'content-type',
  );
  const defaultContentType = (value: string) => {
    if (!hasContentType) headers.push({ name: 'Content-Type', value });
  };

  switch (resolved.body.mode) {
    case 'none':
      return null;
    case 'json': {
      if (resolved.body.text === '') return null;
      defaultContentType('application/json');
      return Buffer.from(resolved.body.text, 'utf8');
    }
    case 'raw': {
      if (resolved.body.text === '') return null;
      defaultContentType('text/plain');
      return Buffer.from(resolved.body.text, 'utf8');
    }
    case 'form-urlencoded': {
      const params = new URLSearchParams();
      for (const entry of resolved.body.entries) {
        if (entry.key === '') continue;
        params.append(entry.key, entry.value);
      }
      const text = params.toString();
      if (text === '') return null;
      defaultContentType('application/x-www-form-urlencoded');
      return Buffer.from(text, 'utf8');
    }
  }
}
