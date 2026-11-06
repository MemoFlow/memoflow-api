import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '../../domain/users/user.entity';

/**
 * Blocks unverified accounts with 403 when `EMAIL_VERIFICATION_REQUIRED` is
 * on. Must run after `JwtAuthGuard` (it reads the authenticated user).
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<boolean>('EMAIL_VERIFICATION_REQUIRED') !== true) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ user?: User }>();
    if (!request.user?.isEmailVerified) {
      throw new ForbiddenException('Email not verified');
    }
    return true;
  }
}
