export function slugify(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    throw new Error("clientName is invalid");
  }

  // Keep username reasonably small for UX.
  return normalized.slice(0, 64);
}

