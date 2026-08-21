export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

/**
 * A profile edit. Every field is optional — the client sends only what the
 * user changed, exactly as `UpdateRequestInput` does.
 *
 * ⚠️ `currentPassword` is **required by the server whenever `email` changes**,
 * and ignored otherwise. Changing the address a password reset would be sent
 * to is an account-takeover step, so it is re-authenticated even though a live
 * access token is already proving who the caller is. Renaming yourself is not,
 * and demanding a password for it would train the reflex that this prompt is
 * noise.
 */
export interface UpdateProfileInput {
  name?: string;
  email?: string;
  currentPassword?: string;
}

/**
 * ⚠️ Deliberately its own input and its own endpoint rather than a `password`
 * field on `UpdateProfileInput`. A password change revokes the account's other
 * sessions and a profile edit does not, so folding them together would make one
 * request that sometimes signs your other devices out — invisible in the type
 * and impossible to document at the call site.
 */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/** The refresh token never appears here — it travels only in the httpOnly cookie. */
export interface AuthResponse {
  accessToken: string;
  /** Seconds until `accessToken` expires, so a client can refresh proactively. */
  expiresIn: number;
  user: AuthUser;
}

/** One live login, as shown in a "your devices" list. */
export interface SessionSummary {
  id: string;
  /** True for the session that issued the access token making this request. */
  current: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}
