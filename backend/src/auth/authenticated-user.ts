import type { Request } from 'express';

/** What the guard proves about the caller once a token verifies. */
export interface AuthenticatedUser {
    /** `sub` — the user id. The only identity a handler should trust. */
    userId: string;
    /** `sid` — the session that minted the token, for revocation and auditing. */
    sessionId: string;
    /** `jti` — this token's id, useful in logs when tracing a single token. */
    tokenId: string;
}

/**
 * An Express request after `JwtAuthGuard` has run. `user` is non-optional
 * because the guard either populates it or rejects the request, so a handler
 * behind the guard never has to null-check it.
 */
export interface AuthenticatedRequest extends Request {
    user: AuthenticatedUser;
}
