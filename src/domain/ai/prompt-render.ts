/**
 * Pure prompt rendering. Placeholders look like `{{name}}` (whitespace inside
 * the braces is allowed). Rendering is a single pass with a function
 * replacer, so substituted values are never re-scanned and `$&`-style
 * sequences in values are never interpreted.
 */
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/** Distinct placeholder names used by a template, in order of first use. */
export function listPlaceholders(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    names.add(match[1]);
  }
  return [...names];
}

/** Throws on a placeholder that has no entry in `vars`. */
export function renderPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      throw new Error(`Unknown prompt placeholder "${name}"`);
    }
    return vars[name];
  });
}
