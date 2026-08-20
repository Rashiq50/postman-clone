import { configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'
import { authReducer } from '../features/auth/authSlice'
import { baseApi } from './baseApi'

export const store = configureStore({
  reducer: {
    [baseApi.reducerPath]: baseApi.reducer,
    auth: authReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(baseApi.middleware),
})

/**
 * Wires up the `focus` and `online` events RTK Query's `refetchOnFocus` /
 * `refetchOnReconnect` listen for. Nothing refetches on focus by *default* —
 * the options are set per endpoint, and today only `getTree` opts in (see
 * `Sidebar`). Without this call those options are silently inert, which is the
 * failure mode to know about: the code reads as if it reconciles and does not.
 */
setupListeners(store.dispatch)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
