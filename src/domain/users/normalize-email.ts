/** Canonical form of an email address: trimmed and lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
