/**
 * Server-computed word count for section content — framework-free so it can
 * be unit tested in isolation and reused by any use-case that writes
 * `content`.
 */
export function wordCount(content: string): number {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
