/**
 * **Auth state is per-tab. Only the refresh cookie is shared.**
 *
 * The access token lives in each tab's Redux store, which is per-JS-context.
 * The refresh cookie is one browser-wide slot (fixed name, host-only,
 * `Path=/api/v1/auth`). So `loggedOut()` in one tab does **not** log out other
 * tabs — they keep working off their in-memory access token until it expires
 * (at most `JWT_ACCESS_EXPIRES_IN`) or they hit a 401, at which point their
 * refresh fails against the cleared or revoked cookie and *then* they fall back
 * to `/login`. Convergence is by expiry, not by broadcast. Do not assume
 * synchronous cross-tab logout.
 *
 * `BroadcastChannel` would make it synchronous and is the intended extension
 * point, but it is deliberately not taken here: it would be a second source of
 * truth for auth state living outside Redux. Revisit only if a product
 * requirement demands instant cross-tab logout.
 */

import type { AuthUser } from '@raven/contracts'
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { RootState } from '../../app/store'

type AuthState = {
  /**
   * Memory only. Never written to localStorage or sessionStorage, so a reload
   * starts at null and the session is restored from the httpOnly refresh
   * cookie instead. Do not add redux-persist or any storage middleware here.
   */
  accessToken: string | null
  user: AuthUser | null
  /** False until the boot-time silent refresh has settled, either way. */
  bootstrapped: boolean
}

const initialState: AuthState = {
  accessToken: null,
  user: null,
  bootstrapped: false,
}

/**
 * There is deliberately no `status` field: per-request loading already lives in
 * RTK Query's hooks, and duplicating it here would create two sources of truth.
 * `bootstrapped` is the one flag RTK Query cannot give us, because the boot
 * refresh is dispatched outside React.
 */
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    credentialsReceived(
      state,
      action: PayloadAction<{ accessToken: string; user?: AuthUser }>,
    ) {
      state.accessToken = action.payload.accessToken
      if (action.payload.user) state.user = action.payload.user
    },
    userLoaded(state, action: PayloadAction<AuthUser>) {
      state.user = action.payload
    },
    loggedOut(state) {
      state.accessToken = null
      state.user = null
      // `bootstrapped` stays true: signing out must not re-show the splash.
    },
    bootstrapFinished(state) {
      state.bootstrapped = true
    },
  },
})

export const { credentialsReceived, userLoaded, loggedOut, bootstrapFinished } =
  authSlice.actions

export const selectAccessToken = (state: RootState) => state.auth.accessToken
export const selectCurrentUser = (state: RootState) => state.auth.user
export const selectIsAuthenticated = (state: RootState) =>
  state.auth.accessToken !== null
export const selectIsBootstrapped = (state: RootState) =>
  state.auth.bootstrapped

export const authReducer = authSlice.reducer
