import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  AUTH_LOGIN_EVENT,
  AUTH_LOGIN_FAILED_EVENT,
} from '../../domain/audit/audit-events';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';
import { JwtPayload } from './jwt-payload.interface';

export interface LoginUserInput {
  email: string;
  password: string;
}

export interface LoginUserResult {
  accessToken: string;
}

@Injectable()
export class LoginUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: LoginUserInput): Promise<LoginUserResult> {
    const user = await this.userRepository.findByEmail(input.email);
    if (!user) {
      // Unknown email — the audit trail's userId is null (there is no user
      // to attribute the attempt to), but the email is kept in metadata so
      // this pairs with the rate-limiter slice's per-email throttling.
      this.eventEmitter.emit(AUTH_LOGIN_FAILED_EVENT, {
        userId: null,
        email: input.email,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(
      input.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      this.eventEmitter.emit(AUTH_LOGIN_FAILED_EVENT, {
        userId: user.id,
        email: input.email,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.userRepository.updateLastActiveAt(user.id);

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwtService.signAsync(payload);

    this.eventEmitter.emit(AUTH_LOGIN_EVENT, { userId: user.id });

    return { accessToken };
  }
}
