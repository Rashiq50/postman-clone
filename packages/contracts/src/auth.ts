export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
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
