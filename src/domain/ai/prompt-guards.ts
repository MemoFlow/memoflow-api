/**
 * Pure guards around untrusted text sent to, and model output received from,
 * the LLM. Best effort by design: they reduce what leaks and what can break
 * out of the untrusted fence; they are not a security boundary on their own.
 *
 * Every regex here has bounded quantifiers or unambiguous structure so a
 * hostile input can't trigger catastrophic backtracking.
 */

export const REDACTION_PLACEHOLDER = '[REDACTED]';

export interface RedactionResult {
  text: string;
  /** How many secrets were replaced. */
  redactions: number;
}

/** Whole-match replacements. */
const SECRET_PATTERNS: readonly RegExp[] = [
  // PEM private key block (terminated, or running to the end of the input).
  // The body stops at the next BEGIN so repeated headers can't rescan.
  /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----(?:(?!-----BEGIN)[\s\S]){0,10000}?(?:-----END [A-Z ]{0,30}PRIVATE KEY-----|$|(?=-----BEGIN))/g,
  // AWS access key ids.
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // GitHub tokens.
  /\bgh[pousr]_[A-Za-z0-9]{30,255}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,255}/g,
  // GitLab personal access tokens.
  /\bglpat-[A-Za-z0-9_-]{20,255}/g,
  // npm tokens.
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  // Google API keys.
  /\bAIza[A-Za-z0-9_-]{35}/g,
  // Stripe secret and restricted keys.
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,99}/g,
  // sk- style API keys (OpenAI, Anthropic `sk-ant-`, OpenRouter `sk-or-`).
  /\bsk-[A-Za-z0-9_-]{20,512}/g,
  // Slack tokens.
  /\bxox[abeprs]-[A-Za-z0-9-]{10,200}/g,
  // JWTs.
  /\beyJ[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{5,4096}/g,
  // Authorization headers with Basic credentials.
  /\bAuthorization[ \t]{0,5}:[ \t]{0,5}Basic[ \t]{1,10}[A-Za-z0-9+/=]{8,2048}/gi,
  // Authorization bearer tokens (20+ chars keeps prose like "Bearer of
  // news" alone).
  /\bBearer[ \t]{1,10}[A-Za-z0-9._~+/=-]{20,2048}/gi,
];

/** `scheme://user:pass@host` — only the credentials are replaced. */
const URL_CREDENTIALS =
  /(\b[a-z][a-z0-9+.-]{1,20}:\/\/)[^\s/@:]{1,100}:[^\s/@]{1,200}@/gi;

/**
 * Value of a `key = value` assignment: 12+ unbroken characters, not a plain
 * URL, containing a digit or symbol other than `-` (so hyphenated prose such
 * as "développement-durable" is left alone).
 */
const ASSIGNMENT_VALUE = String.raw`(?!(?:https?|ftp)://)(?=[^\s"'\\]{0,200}[^\s"'\\\p{L}-])[^\s"'\\]{12,200}`;

/**
 * Unambiguous keys (`password`, `api_key`, and compounds like `db_password`
 * or `access_token`) with `=` or `:`. Whole words only: `tokenizer` and
 * `secretary` are not keys.
 */
const STRONG_ASSIGNMENT = new RegExp(
  String.raw`((?<![A-Za-z0-9])(?:(?:[A-Za-z0-9]{1,20}[_.]){0,4}(?:password|passwd|pwd|credentials?|(?:secret|private|access|auth)[_-]?key|api[_-]?key|apikey|mots? de passe)|(?:[A-Za-z0-9]{1,20}[_.]){1,4}(?:secret|token))(?![A-Za-z0-9])["']?[ \t]{0,5}[=:][ \t]{0,5}["']?)` +
    ASSIGNMENT_VALUE,
  'giu',
);

/**
 * The bare words `secret` and `token` are ordinary prose, so they need `=`
 * or a quoted value; a bare colon is not enough.
 */
const AMBIGUOUS_ASSIGNMENT = new RegExp(
  String.raw`((?<![A-Za-z0-9_.])(?:secret|token)(?![A-Za-z0-9])["']?[ \t]{0,5}(?:=[ \t]{0,5}["']?|:[ \t]{0,5}["']))` +
    ASSIGNMENT_VALUE,
  'giu',
);

/**
 * A bare colon is enough for `token` only when the value looks like a token:
 * 16+ characters including a digit (YAML `token: 9f8e7d6c5b4a3210ffee`).
 */
const TOKEN_COLON_ASSIGNMENT = new RegExp(
  String.raw`((?<![A-Za-z0-9_.])token(?![A-Za-z0-9])["']?[ \t]{0,5}:[ \t]{0,5}["']?)(?!(?:https?|ftp)://)(?=[^\s"'\\]{0,200}\d)[^\s"'\\]{16,200}`,
  'giu',
);

export function redactSecrets(text: string): RedactionResult {
  let redactions = 0;
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, () => {
      redactions += 1;
      return REDACTION_PLACEHOLDER;
    });
  }
  out = out.replace(URL_CREDENTIALS, (_match, scheme: string) => {
    redactions += 1;
    return `${scheme}${REDACTION_PLACEHOLDER}@`;
  });
  for (const pattern of [
    STRONG_ASSIGNMENT,
    AMBIGUOUS_ASSIGNMENT,
    TOKEN_COLON_ASSIGNMENT,
  ]) {
    out = out.replace(pattern, (_match, prefix: string) => {
      redactions += 1;
      return `${prefix}${REDACTION_PLACEHOLDER}`;
    });
  }
  return { text: out, redactions };
}

/**
 * Opening or closing `<untrusted_...` tag marker, any case, with optional
 * whitespace after `<` and `/` (`</ untrusted_x >`). The structure is
 * unambiguous, so whitespace runs don't backtrack quadratically.
 */
const UNTRUSTED_TAG_MARKER = /(<\s*(?:\/\s*)?untrusted)_/gi;

/**
 * Defuses anything shaped like an `untrusted_` fence tag by turning the
 * underscore into a hyphen (`</untrusted_x>` becomes `</untrusted-x>`). The
 * rest of the text is untouched and the length is unchanged.
 */
export function neutralizeUntrustedTags(text: string): string {
  return text.replace(UNTRUSTED_TAG_MARKER, '$1-');
}

/** Redacts secrets, then neutralises fence tags. */
export function prepareUntrustedText(text: string): string {
  return neutralizeUntrustedTags(redactSecrets(text).text);
}

const MAX_WALK_DEPTH = 20;
const SENSITIVE_KEY =
  /^(?:.*[_.-])?(?:password|passwd|pwd|credentials?|secret|token|(?:secret|private|access|auth)[_-]?key|api[_-]?key|apikey|authorization)$/i;

/**
 * Applies `prepareUntrustedText` to every string leaf of a JSON-like value
 * (before it is serialised, so quotes and escapes can't hide a secret) and
 * defuses fence tags in object keys. A string value under a key named like a
 * secret (`password`, `api_key`, ...) is replaced outright. Each leaf is cut
 * at `leafCap` first, bounding regex work. Anything nested deeper than 20
 * levels becomes a placeholder.
 */
export function prepareUntrustedValue(
  value: unknown,
  leafCap: number,
  depth = 0,
): unknown {
  if (typeof value === 'string') {
    return prepareUntrustedText(value.slice(0, leafCap));
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_WALK_DEPTH) return REDACTION_PLACEHOLDER;
  if (Array.isArray(value)) {
    return value.map((v) => prepareUntrustedValue(v, leafCap, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[neutralizeUntrustedTags(key)] =
      typeof v === 'string' && SENSITIVE_KEY.test(key)
        ? REDACTION_PLACEHOLDER
        : prepareUntrustedValue(v, leafCap, depth + 1);
  }
  return out;
}

/** Every string leaf of a JSON-like value, unmodified. */
export function collectStrings(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object' || depth >= MAX_WALK_DEPTH) {
    return [];
  }
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.flatMap((v) => collectStrings(v, depth + 1));
}

export interface LeakContext {
  /** Per-request nonce embedded in the system prompt (the canary). */
  nonce: string;
  /** The rendered system prompt. */
  system: string;
  /** Text the model legitimately saw and may quote back. */
  source: string;
}

const MIN_LEAK_SENTENCE_CHARS = 40;

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * True when the output contains the nonce, or a verbatim sentence of 40+
 * characters from the rendered system prompt that doesn't also appear in the
 * source text (a user may legitimately write a system-like sentence).
 */
export function leaksPrompt(output: string, context: LeakContext): boolean {
  if (
    context.nonce &&
    output.toLowerCase().includes(context.nonce.toLowerCase())
  ) {
    return true;
  }
  const normalizedOutput = normalize(output);
  const normalizedSource = normalize(context.source);
  const sentences = context.system
    .split(/[.!?\n]+/)
    .map(normalize)
    .filter((s) => s.length >= MIN_LEAK_SENTENCE_CHARS);
  return sentences.some(
    (sentence) =>
      normalizedOutput.includes(sentence) &&
      !normalizedSource.includes(sentence),
  );
}
