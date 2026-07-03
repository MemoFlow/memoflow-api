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
}
