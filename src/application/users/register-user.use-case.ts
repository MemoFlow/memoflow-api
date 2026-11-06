import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import {
  AUTH_RESET_LINK_REQUESTED_EVENT,
  AUTH_VERIFICATION_REQUESTED_EVENT,
} from '../../domain/auth/auth-events';
import type {
  AuthResetLinkRequestedEventPayload,
  AuthVerificationRequestedEventPayload,
} from '../../domain/auth/auth-events';
import { normalizeEmail } from '../../domain/users/normalize-email';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';

const BCRYPT_SALT_ROUNDS = 10;

export interface RegisterUserInput {
  email: string;
  password: string;
  displayName: string;
}

/**
 * Registers an account without revealing whether the address was already
 * taken: the caller sees the same outcome (no error, no body) either way.
 * A new address gets a verification email; an existing one gets an "you
 * already have an account" email with a reset link, and is left untouched.
 */
@Injectable()
export class RegisterUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: RegisterUserInput): Promise<void> {
    const email = normalizeEmail(input.email);

    // Hash on both branches so the two paths cost about the same.
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);

    const existing = await this.userRepository.findByEmail(email);
    if (existing) {
      this.emitExistingAccount(email);
      return;
    }

    try {
      const user = await this.userRepository.create({
        email,
        passwordHash,
        displayName: input.displayName,
      });
      const payload: AuthVerificationRequestedEventPayload = {
        userId: user.id,
      };
      this.eventEmitter.emit(AUTH_VERIFICATION_REQUESTED_EVENT, payload);
    } catch (err) {
      // A concurrent registration won the unique-email race.
      if (err instanceof ConflictException) {
        this.emitExistingAccount(email);
        return;
      }
      throw err;
    }
  }

  private emitExistingAccount(email: string): void {
    const payload: AuthResetLinkRequestedEventPayload = {
      email,
      reason: 'existing_account',
    };
    this.eventEmitter.emit(AUTH_RESET_LINK_REQUESTED_EVENT, payload);
  }
}
