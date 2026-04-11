import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export type JwtRole = "admin" | "client";

export type AccessTokenPayload = {
  sub: string;
  role: JwtRole;
  username?: string;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

/**
 * Normalise any role string to JwtRole.
 *
 * The Custom app backend may use different casing ("Admin", "Client") or
 * completely different strings ("coral", "cad"). We map:
 *   admin / Admin / ADMIN  → "admin"
 *   client / Client        → "client"
 *   anything else          → null  (will be rejected by requireRole)
 */
function normalizeRole(role: unknown): JwtRole | null {
  if (typeof role !== "string") return null;
  const lower = role.toLowerCase();
  if (lower === "admin") return "admin";
  if (lower === "client") return "client";
  return null;
}

/**
 * Attempt to decode and normalise a JWT payload using the given secret.
 * Returns null instead of throwing so the caller can try the next secret.
 */
function tryVerify(token: string, secret: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload;

    // Accept both `sub` (RFC standard) and `id` (used by the Custom app backend)
    const sub = decoded.sub ?? (decoded as any).id ?? (decoded as any).Id;
    const role = normalizeRole((decoded as any).role);

    if (!sub || !role) return null;

    // `username` is optional — fall back to email for legacy tokens
    const username =
      decoded.username ??
      (decoded as any).email ??
      undefined;

    return {
      sub: String(sub),
      role,
      username: username ? String(username) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Verify an access token against one or both known secrets.
 *
 * Priority:
 *  1. chandra_backend's own JWT_SECRET  — tokens issued by this backend
 *  2. LEGACY_JWT_SECRET                 — tokens issued by the Custom app backend
 *
 * By configuring LEGACY_JWT_SECRET to match the Custom app backend's JWT_SECRET,
 * the mobile app can log in once (via the existing login screen) and use the
 * same JWT for both the Custom and Catalog flows — no duplicate auth needed.
 *
 * Setup:
 *   Add to chandra_backend/.env:
 *     LEGACY_JWT_SECRET=<copy the JWT_SECRET value from the Custom app's backend>
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  // 1. Try own secret
  const ownPayload = tryVerify(token, env.JWT_SECRET);
  if (ownPayload) return ownPayload;

  // 2. Try legacy secret (Custom app backend) if configured
  if (env.LEGACY_JWT_SECRET) {
    const legacyPayload = tryVerify(token, env.LEGACY_JWT_SECRET);
    if (legacyPayload) return legacyPayload;
  }

  throw new Error("Unauthorized — token could not be verified");
}
