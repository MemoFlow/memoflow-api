import { ConflictException } from '@nestjs/common';
import { LimitReachedError } from '../../domain/limits/storage-limits';

/** Runs `fn`, translating a domain `LimitReachedError` into a 409. */
export async function conflictOnLimit<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LimitReachedError) {
      throw new ConflictException(err.message);
    }
    throw err;
  }
}
