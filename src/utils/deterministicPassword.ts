import crypto from "crypto";

export function deterministicPasswordFromClientName(
  clientName: string,
  passwordSeed: string,
  length = 16
): string {
  const normalized = clientName.trim().toLowerCase();
  if (!normalized) throw new Error("clientName is invalid");

  // Deterministic, but depends on a server-side secret seed.
  // Using hex keeps the password strictly alphanumeric (0-9, a-f).
  const hmacHex = crypto
    .createHmac("sha256", passwordSeed)
    .update(normalized, "utf8")
    .digest("hex");

  return hmacHex.slice(0, length).toUpperCase();
}

