/**
 * Claims carried by an access token. Keep this minimal and non-sensitive: the
 * payload is only signed, not encrypted, so anyone holding the token can read
 * it. Anything that can change (name, roles, permissions) is deliberately left
 * out — a stale copy inside a token cannot be corrected until it expires.
 */
export interface JwtPayload {
    /** User id. `sub` is the registered claim for the token's subject. */
    sub: string;
    /** Session id, so a token can be tied back to the refresh session that minted it. */
    sid: string;
    /** Unique token id, for logging and future denylisting. */
    jti: string;
    iat: number;
    exp: number;
    iss: string;
    aud: string;
}
