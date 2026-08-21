import type {
  AuthResponse,
  AuthUser,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from '@raven/contracts'
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

    register: builder.mutation<AuthResponse, RegisterInput>({
      query: (body) => ({ url: 'auth/register', method: 'POST', body }),
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

    /**
     * The profile edit.
     *
     * ⚠️ It feeds `authSlice` through `onQueryStarted` like every other
     * endpoint here, and it must: the header renders the user's name out of the
     * slice, so a rename that only invalidated the `Me` tag would leave the old
     * name in the header until something happened to refetch — which looks like
     * the save silently failed.
     *
     * `invalidatesTags: ['Me']` as well, for any subscriber reading the query
     * rather than the slice. The two are not redundant: the slice is the
     * synchronous copy the chrome reads, the tag is the cache.
     */
    updateProfile: builder.mutation<AuthUser, UpdateProfileInput>({
      query: (body) => ({ url: 'auth/me', method: 'PATCH', body }),
      invalidatesTags: ['Me'],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          dispatch(userLoaded((await queryFulfilled).data))
        } catch {
          // Surfaced through the mutation's own `error`.
        }
      },
    }),

    /**
     * ⚠️ **This revokes the account's other sessions server-side**, so the
     * `Session` tag is invalidated — the sessions list is otherwise showing
     * devices that have just been signed out, and it is the very screen next
     * door.
     *
     * ⚠️ It does *not* touch `authSlice`. The server deliberately spares the
     * caller's own session, so this tab's access token stays valid and a
     * `loggedOut()` here would sign the user out of the change they just made.
     */
    changePassword: builder.mutation<void, ChangePasswordInput>({
      query: (body) => ({
        url: 'auth/change-password',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Session'],
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
  useChangePasswordMutation,
  useLoginMutation,
  useLogoutMutation,
  useLogoutAllMutation,
  useMeQuery,
  useRegisterMutation,
  useUpdateProfileMutation,
} = authApi
