import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  AI_CONSENT_REQUIRED_CODE,
  AI_CONSENT_REQUIRED_MESSAGE,
} from '../../domain/ai/ai-consent';
import { User } from '../../domain/users/user.entity';

/**
 * Blocks users without current AI consent with 403 `AI_CONSENT_REQUIRED`.
 * Must run after `JwtAuthGuard` (it reads the authenticated user, which
 * `JwtStrategy` loads fresh on every request). Applies to admins too.
 */
@Injectable()
export class AiConsentGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: User }>();
    if (!request.user?.hasCurrentAiConsent) {
      throw new ForbiddenException({
        message: AI_CONSENT_REQUIRED_MESSAGE,
        error: AI_CONSENT_REQUIRED_CODE,
      });
    }
    return true;
  }
}
