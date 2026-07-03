import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../../application/auth/jwt-payload.interface';
import { GetUserByIdUseCase } from '../../application/users/get-user-by-id.use-case';
import { User } from '../../domain/users/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly getUserById: GetUserByIdUseCase,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    try {
      return await this.getUserById.execute(payload.sub);
    } catch (err) {
      // A missing user means the token no longer maps to an account (deleted
      // user, forged sub) — that is an auth failure. Anything else (e.g. a DB
      // outage) is a real server error and must surface as 5xx, not be masked
      // as an invalid token.
      if (err instanceof NotFoundException) {
        throw new UnauthorizedException('Invalid token');
      }
      throw err;
    }
  }
}
