import { Injectable, UnauthorizedException } from '@nestjs/common';
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
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
