import type {
  AuthResponse,
  AuthUser,
  LoginInput,
} from '@postman-clone/contracts'
import { baseApi } from '../../app/baseApi'
import { credentialsReceived, loggedOut, userLoaded } from './authSlice'

/**
 * The slice is fed from `onQueryStarted` rather than `extraReducers` +
 * `addMatcher(authApi.endpoints.login.matchFulfilled)`. The latter would force
 * `authSlice → authApi → baseApi → authSlice`: a value-level cycle evaluated at
 * module scope, since the `extraReducers` builder runs during module evaluation
 * and would dereference a possibly-uninitialised `authApi.endpoints`. This way
 * the arrow only ever points one way.
 */
export const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation<AuthResponse, LoginInput>({
      query: (body) => ({ url: 'auth/login', method: 'POST', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled
          dispatch(
            credentialsReceived({
              accessToken: data.accessToken,
              user: data.user,
            }),
          )
        } catch {
          // Surfaced through the mutation's own `error`.
        }
      },
    }),

    /**
     * Named as an endpoint as well as existing raw inside `baseApi`: the boot
     * sequence needs to trigger a refresh from outside a failing request, and
     * having a name is what lets `NEVER_REAUTH.has('refresh')` keep the boot
     * call from recursing into itself.
     */
    refresh: builder.mutation<AuthResponse, void>({
      query: () => ({ url: 'auth/refresh', method: 'POST' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled
          dispatch(
            credentialsReceived({
              accessToken: data.accessToken,
              user: data.user,
            }),
          )
        } catch {
          // No cookie, expired, or revoked. Staying anonymous is correct.
        }
      },
    }),

    logout: builder.mutation<void, void>({
      query: () => ({ url: 'auth/logout', method: 'POST' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled
        } catch {
          // Cleared locally regardless — signing out must work offline.
        } finally {
          dispatch(loggedOut())
        }
      },
    }),

    logoutAll: builder.mutation<void, void>({
      query: () => ({ url: 'auth/logout-all', method: 'POST' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled
        } catch {
          // Same as `logout`: local state is cleared either way.
        } finally {
          dispatch(loggedOut())
        }
      },
    }),

    me: builder.query<AuthUser, void>({
      query: () => ({ url: 'auth/me' }),
      providesTags: ['Me'],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled
          dispatch(userLoaded(data))
        } catch {
          // A 401 here is handled by the base query's refresh path.
        }
      },
    }),
  }),
})

export const {
  useLoginMutation,
  useLogoutMutation,
  useLogoutAllMutation,
  useMeQuery,
} = authApi
