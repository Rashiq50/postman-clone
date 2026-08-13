import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Opts a route (or a whole controller) out of the global `JwtAuthGuard`.
 *
 * Authentication is on by default for every route in the app, so forgetting to
 * protect a new endpoint is no longer possible — the mistake now runs the other
 * way, and an unauthenticated endpoint has to say so in one visible line that
 * shows up in review and in `grep`.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
