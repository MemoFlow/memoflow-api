import { User } from './user.entity';

export const USER_REPOSITORY = Symbol('UserRepository');

export interface CreateUserData {
  email: string;
  passwordHash: string;
  displayName: string;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  updateLastActiveAt(id: string): Promise<void>;
  /** Sets `disabledAt` (or clears it when `null`). */
  setDisabledAt(id: string, disabledAt: Date | null): Promise<void>;
  /**
   * Top `limit` enabled (not disabled) users by `xp` descending, for the
   * leaderboard.
   */
  findTopByXp(limit: number): Promise<User[]>;
}
