import type { AppDispatch } from '../../app/store'
import { authApi } from './authApi'
import { bootstrapFinished } from './authSlice'

/**
 * Restores the session from the httpOnly refresh cookie, once, before React
 * mounts. Called at module scope in `main.tsx` and never from a `useEffect`:
 * an effect runs twice under StrictMode, and with refresh-token rotation the
 * second call presents a token the first already burned, so the app appears
 * logged out in development only.
 */
export async function bootstrapAuth(dispatch: AppDispatch): Promise<void> {
  const attempt = dispatch(authApi.endpoints.refresh.initiate())
  try {
    // `credentialsReceived` fires from the endpoint's `onQueryStarted`.
    await attempt.unwrap()
  } catch {
    // No cookie, expired, or revoked. Staying anonymous is correct.
  } finally {
    attempt.reset()
    dispatch(bootstrapFinished())
  }
}
