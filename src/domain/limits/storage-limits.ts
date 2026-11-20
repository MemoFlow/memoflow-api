/**
 * Per-user / per-document storage caps (authorization hardening, phase 4).
 * One place for the numbers; use-cases receive them through the
 * `STORAGE_LIMITS` injection token (defaulting to `DEFAULT_STORAGE_LIMITS`)
 * so e2e tests can override them with small values.
 *
 * Over a cap the API answers 409 Conflict. Nothing is ever auto-pruned.
 */
export const STORAGE_LIMITS = Symbol('StorageLimits');

export interface StorageLimits {
  /** Documents owned by one user. */
  maxDocumentsPerUser: number;
  /** Sections inside one document. */
  maxSectionsPerDocument: number;
  /** Saved versions (Mongo `document_versions`) of one document. */
  maxVersionsPerDocument: number;
  /** Templates created by one user (admins are exempt). */
  maxTemplatesPerUser: number;
}

export const DEFAULT_STORAGE_LIMITS: StorageLimits = {
  maxDocumentsPerUser: 200,
  maxSectionsPerDocument: 50,
  maxVersionsPerDocument: 50,
  maxTemplatesPerUser: 50,
};

export type LimitedResource = 'document' | 'section' | 'version' | 'template';

/**
 * A storage cap would be exceeded. Thrown by repositories (inside the
 * transaction that enforces the cap) and mapped to 409 by use-cases.
 */
export class LimitReachedError extends Error {
  constructor(
    readonly resource: LimitedResource,
    readonly limit: number,
  ) {
    super(
      `${resource.charAt(0).toUpperCase()}${resource.slice(1)} limit reached (${limit})`,
    );
    this.name = 'LimitReachedError';
  }
}
