import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SessionsService } from '../sessions/sessions.service';
import type { AuthenticatedRequest, AuthenticatedUser } from './authenticated-user';
import type { JwtPayload } from './jwt-payload';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Rejects any request that does not carry a valid access token for a live
 * session, and attaches the caller's identity to the request for handlers.
 *
 * Registered globally as an `APP_GUARD` (see auth.module.ts), so protection is
 * the default for every route in the app and `@Public()` is the exception.
 *
 * Token verification deliberately passes no options: `JwtService` merges the
 * `verifyOptions` from the `JwtModule` registration, so the algorithm
 * allowlist, issuer and audience checks are applied here without being
 * restated — and cannot drift out of sync with how tokens are signed.
 *
 * This is a plain guard rather than a Passport strategy. There is exactly one
 * way to authenticate, so Passport's indirection buys nothing, and skipping it
 * keeps the token contract visible in one file.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly sessionsService: SessionsService,
        private readonly reflector: Reflector,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Handler first, then controller: a `@Public()` route inside a
        // protected controller is honoured, and vice versa.
        const isPublic = this.reflector.getAllAndOverride<boolean>(
            IS_PUBLIC_KEY,
            [context.getHandler(), context.getClass()],
        );
        if (isPublic) {
            return true;
        }

        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const token = extractBearerToken(request.header('authorization'));

        if (!token) {
            throw new UnauthorizedException('Missing access token');
        }

        let payload: JwtPayload;
        try {
            payload = this.jwtService.verify<JwtPayload>(token);
        } catch {
            // Expiry, a bad signature, a wrong issuer and a malformed token all
            // collapse to one message: the specific reason is a hint an attacker
            // can tune against, and a legitimate client's move is the same
            // either way — refresh, then retry.
            throw new UnauthorizedException('Invalid access token');
        }

        // A signature only proves the token was ours when issued, not that it
        // should still work. Logging out or revoking a session has to take
        // effect now rather than whenever the token happens to expire, so the
        // session behind `sid` is checked on every request. That is one indexed
        // primary-key lookup — the price of revocation that actually revokes.
        if (!(await this.sessionsService.isActive(payload.sid))) {
            // Distinct from the message above on purpose: the remedy differs.
            // A rejected token means refresh; a dead session means log in again,
            // and no refresh attempt will help.
            throw new UnauthorizedException('Session is no longer active');
        }

        // Trust nothing from the request body or query for identity — only the
        // signed claims land on `request.user`.
        const user: AuthenticatedUser = {
            userId: payload.sub,
            sessionId: payload.sid,
            tokenId: payload.jti,
        };
        request.user = user;

        return true;
    }
}

/**
 * Pulls the token out of an `Authorization: Bearer <token>` header. Returns
 * undefined for anything else — including `Basic`, a bare token with no scheme,
 * or extra segments — rather than guessing at the caller's intent.
 */
function extractBearerToken(header: string | undefined): string | undefined {
    if (!header) {
        return undefined;
    }

    const [scheme, token, ...rest] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
        return undefined;
    }

    return token;
}
