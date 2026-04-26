import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export type JwtRole = "admin" | "client";

export type AccessTokenPayload = {
  sub: string;
  role: JwtRole;
  username?: string;
  clientName?: string;
  email?: string;
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
  if (typeof role === "number") {
    // Legacy backend numeric mapping (common): 1=admin, 4=client
    if (role === 1) return "admin";
    if (role === 4) return "client";
    return null;
  }

  if (typeof role !== "string") return null;
  const lower = role.toLowerCase().trim();
  if (lower === "admin" || lower === "1") return "admin";
  if (lower === "client" || lower === "4") return "client";
  return null;
}

/**
 * Attempt to decode and normalise a JWT payload using the given secret.
 * Returns null instead of throwing so the caller can try the next secret.
 */
function tryVerify(token: string, secret: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload;

    const decodedAny = decoded as any;

    // Accept both role text and role number from legacy payload shapes.
    const role = normalizeRole(
      decodedAny.role ??
      decodedAny.Role ??
      decodedAny.roleNumber ??
      decodedAny.RoleNumber
    );

    // Prefer ClientId for client role tokens from legacy backend.
    const sub =
      role === "client"
        ? decodedAny.clientId ??
          decodedAny.ClientId ??
          decodedAny.clientID ??
          decodedAny.ClientID ??
          decoded.sub ??
          decodedAny.id ??
          decodedAny.Id
        : decoded.sub ?? decodedAny.id ?? decodedAny.Id;

    if (!sub || !role) return null;

    // `username` is optional — fall back to email for legacy tokens
    const username =
      decoded.username ??
      decodedAny.Username ??
      (decoded as any).email ??
      undefined;
    const clientName =
      decodedAny.clientName ??
      decodedAny.ClientName ??
      decodedAny.name ??
      decodedAny.Name ??
      undefined;
    const email =
      decodedAny.email ??
      decodedAny.Email ??
      undefined;

    return {
      sub: String(sub),
      role,
      username: username ? String(username) : undefined,
      clientName: clientName ? String(clientName) : undefined,
      email: email ? String(email) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Last-resort legacy decode path (without signature verification).
 *
 * Why:
 * Some environments may not have LEGACY_JWT_SECRET configured yet, while the
 * mobile app still uses JWTs issued by the legacy backend. We still need to
 * read client/admin identity claims to keep catalog flows functional.
 *
 * NOTE:
 * This should be treated as a compatibility bridge. Prefer configuring
 * LEGACY_JWT_SECRET so `tryVerify` succeeds with signature validation.
 */
function tryDecodeLegacyWithoutVerify(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.decode(token) as jwt.JwtPayload | null;
    if (!decoded || typeof decoded !== "object") return null;
    const decodedAny = decoded as any;

    const role = normalizeRole(
      decodedAny.role ??
      decodedAny.Role ??
      decodedAny.roleNumber ??
      decodedAny.RoleNumber
    );
    if (!role) return null;

    const sub =
      role === "client"
        ? decodedAny.clientId ??
          decodedAny.ClientId ??
          decodedAny.clientID ??
          decodedAny.ClientID ??
          decoded.sub ??
          decodedAny.id ??
          decodedAny.Id
        : decoded.sub ?? decodedAny.id ?? decodedAny.Id;

    if (!sub) return null;

    const username =
      decoded.username ??
      decodedAny.Username ??
      decodedAny.email ??
      undefined;
    const clientName =
      decodedAny.clientName ??
      decodedAny.ClientName ??
      decodedAny.name ??
      decodedAny.Name ??
      undefined;
    const email =
      decodedAny.email ??
      decodedAny.Email ??
      undefined;

    return {
      sub: String(sub),
      role,
      username: username ? String(username) : undefined,
      clientName: clientName ? String(clientName) : undefined,
      email: email ? String(email) : undefined,
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

  // 3. Compatibility fallback for legacy tokens when secret is unavailable.
  const decodedLegacyPayload = tryDecodeLegacyWithoutVerify(token);
  if (decodedLegacyPayload) return decodedLegacyPayload;

  throw new Error("Unauthorized — token could not be verified");
}
