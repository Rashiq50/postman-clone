import {
  API_PREFIX,
  API_VERSION,
  type AuthResponse,
} from "@postman-clone/contracts";
import {
  createApi,
  fetchBaseQuery,
  type BaseQueryApi,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from "@reduxjs/toolkit/query/react";
import { credentialsReceived, loggedOut } from "../features/auth/authSlice";
import { toApiError } from "../lib/api-error";
import type { RootState } from "./store";

// In development this stays relative and Vite proxies it. In production set
// VITE_API_URL when the API is not on the same origin as the app.
const apiRoot = import.meta.env.VITE_API_URL ?? `/${API_PREFIX}`;

/**
 * The unauthenticated transport. `credentials: 'include'` is unconditional: it
 * is a no-op in development (the Vite proxy makes the API same-origin) and
 * mandatory in a cross-origin production deploy, so there is nothing to gain
 * from branching on the environment.
 *
 * The access token is read from the store on every call rather than from a
 * module-level mirror — a mirror would be a second place to clear on logout,
 * and it would drift the first time someone forgets one of them. The apparent
 * cycle with `authSlice` is type-only (`import type { RootState }`, which
 * `verbatimModuleSyntax` guarantees emits no import), so the runtime graph is
 * `main → store → baseApi → authSlice`, which is acyclic.
 */
const rawBaseQuery = fetchBaseQuery({
  baseUrl: `${apiRoot}/v${API_VERSION}`,
  credentials: "include",
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth.accessToken;
    if (token) headers.set("authorization", `Bearer ${token}`);
    return headers;
  },
});

/** Endpoints whose 401 *is* the answer, not a symptom of a stale token. */
const NEVER_REAUTH = new Set([
  "login",
  "refresh",
  "logout",
  "logoutAll",
  "register",
]);

function isUnauthenticated(error: FetchBaseQueryError | undefined) {
  return error?.status === 401 && toApiError(error)?.code === "UNAUTHENTICATED";
}

/**
 * The refresh currently in flight, shared by every request that 401s while it
 * runs. Without it a page with three queries fires three refreshes, and since
 * the backend rotates the refresh token the last two present one it already
 * burned — turning an expired access token into a forced logout.
 */
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Calls the refresh endpoint through `rawBaseQuery` rather than dispatching
 * `authApi.endpoints.refresh.initiate()`. Going through `authApi` here would
 * make `app/baseApi → features/auth/authApi → app/baseApi` a genuine runtime
 * cycle, in which `baseApi` is `undefined` at `injectEndpoints` time. These
 * three duplicated lines are the cheaper trade — do not "fix" them into a cycle.
 */
async function runRefresh(
  api: BaseQueryApi,
  extraOptions: object,
): Promise<string | null> {
  const result = await rawBaseQuery(
    { url: "auth/refresh", method: "POST" },
    api,
    extraOptions,
  );
  if (result.error) return null;

  const { accessToken, user } = result.data as AuthResponse;
  api.dispatch(credentialsReceived({ accessToken, user }));
  return accessToken;
}

function refreshOnce(api: BaseQueryApi, extraOptions: object) {
  refreshInFlight ??= runRefresh(api, extraOptions).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * Two behaviours here are deliberate: a request that *starts* while a refresh
 * is in flight may kick off a second refresh once the singleton clears — one
 * wasted round trip, cheaper than gating the hot path — and the retry happens
 * exactly once, its own failure never re-entering this path, so no loop is
 * possible.
 */
export const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions);

  // Gate on the endpoint *name*, not the URL: immune to `args` being a string
  // rather than a `FetchArgs`, and unbreakable by a URL rewrite.
  if (!isUnauthenticated(result.error) || NEVER_REAUTH.has(api.endpoint)) {
    return result;
  }

  // Snapshot the token this request failed under. If it has changed by the time
  // the refresh settles, a login landed behind us and our failure is stale —
  // dropping the loggedOut() on the floor is the entire point. Without this, a
  // slow refresh that resolves after a successful sign-in wipes a session that
  // is perfectly valid.
  const staleToken = (api.getState() as RootState).auth.accessToken;

  const accessToken = await refreshOnce(api, extraOptions);
  if (!accessToken) {
    if ((api.getState() as RootState).auth.accessToken === staleToken) {
      // The only place in the app that decides a session is over.
      api.dispatch(loggedOut());
    }
    return result;
  }

  // `prepareHeaders` reads `getState()` again, so the retry carries the new token.
  return rawBaseQuery(args, api, extraOptions);
};

/**
 * The single API slice. Feature modules add their endpoints with
 * `baseApi.injectEndpoints(...)` rather than calling `createApi` again — one
 * cache, one middleware, and one place for auth headers and 401 refresh.
 */
export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithReauth,
  tagTypes: ["Task", "Session", "Me"],
  endpoints: () => ({}),
});
