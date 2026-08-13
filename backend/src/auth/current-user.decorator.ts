import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedUser } from './authenticated-user';

/**
 * Injects the verified caller into a handler:
 *
 *     findAll(@CurrentUser() user: AuthenticatedUser)
 *
 * Only meaningful behind `JwtAuthGuard` — without it there is no `user` on the
 * request. Handlers should take the owner id from here and never from a route
 * param or body, which the caller controls.
 */
export const CurrentUser = createParamDecorator(
    (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        return request.user;
    },
);
