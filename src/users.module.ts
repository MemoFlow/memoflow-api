import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoginUserUseCase } from './application/auth/login-user.use-case';
import { GetUserByIdUseCase } from './application/users/get-user-by-id.use-case';
import { RegisterUserUseCase } from './application/users/register-user.use-case';
import { USER_REPOSITORY } from './domain/users/user.repository';
import { UserOrmEntity } from './infrastructure/persistence/users/user.orm-entity';
import { UserTypeOrmRepository } from './infrastructure/persistence/users/user.typeorm.repository';
import { AuthController } from './presentation/auth/auth.controller';
import { JwtStrategy } from './presentation/auth/jwt.strategy';
import { UsersController } from './presentation/users/users.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserOrmEntity]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => {
        // JWT_EXPIRES_IN is a free-form duration string (e.g. "15m"); the
        // `ms` StringValue template-literal type can't be derived from a
        // generic string at compile time, so it's cast at this one boundary.
        const expiresIn: any = config.get<string>('JWT_EXPIRES_IN') ?? '15m';
        return {
          secret: config.getOrThrow<string>('JWT_SECRET'),
          signOptions: { expiresIn },
        };
      },
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    { provide: USER_REPOSITORY, useClass: UserTypeOrmRepository },
    RegisterUserUseCase,
    LoginUserUseCase,
    GetUserByIdUseCase,
    JwtStrategy,
  ],
  exports: [USER_REPOSITORY, GetUserByIdUseCase],
})
export class UsersModule {}
