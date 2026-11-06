import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChangePasswordUseCase } from './application/auth/change-password.use-case';
import { ForgotPasswordUseCase } from './application/auth/forgot-password.use-case';
import { LoginUserUseCase } from './application/auth/login-user.use-case';
import { AUTH_MAIL_CONFIG } from './application/auth/auth-mail-config.token';
import type { AuthMailConfig } from './application/auth/auth-mail-config.token';
import { LogoutUserUseCase } from './application/auth/logout-user.use-case';
import { ResendVerificationUseCase } from './application/auth/resend-verification.use-case';
import { ResetPasswordUseCase } from './application/auth/reset-password.use-case';
import { SendPasswordResetEmailUseCase } from './application/auth/send-password-reset-email.use-case';
import { SendVerificationEmailUseCase } from './application/auth/send-verification-email.use-case';
import { VerifyEmailUseCase } from './application/auth/verify-email.use-case';
import { AcceptAiConsentUseCase } from './application/users/accept-ai-consent.use-case';
import { DisableUserUseCase } from './application/users/disable-user.use-case';
import { EnableUserUseCase } from './application/users/enable-user.use-case';
import { WithdrawAiConsentUseCase } from './application/users/withdraw-ai-consent.use-case';
import { GetUserProfileUseCase } from './application/users/get-user-profile.use-case';
import { GetUserByIdUseCase } from './application/users/get-user-by-id.use-case';
import { RegisterUserUseCase } from './application/users/register-user.use-case';
import { AUTH_TOKEN_REPOSITORY } from './domain/auth/auth-token.repository';
import { LOGIN_ATTEMPT_LIMITER } from './domain/auth/login-attempt-limiter.port';
import { EmailModule } from './email.module';
import { USER_REPOSITORY } from './domain/users/user.repository';
import { RedisLoginAttemptLimiter } from './infrastructure/auth/redis-login-attempt-limiter';
import { AuthTokenOrmEntity } from './infrastructure/persistence/auth/auth-token.orm-entity';
import { AuthTokenTypeOrmRepository } from './infrastructure/persistence/auth/auth-token.typeorm.repository';
import { UserOrmEntity } from './infrastructure/persistence/users/user.orm-entity';
import { UserTypeOrmRepository } from './infrastructure/persistence/users/user.typeorm.repository';
import { AuthMailListener } from './presentation/auth/auth-mail.listener';
import { AuthController } from './presentation/auth/auth.controller';
import { JwtStrategy } from './presentation/auth/jwt.strategy';
import { UsersController } from './presentation/users/users.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserOrmEntity, AuthTokenOrmEntity]),
    EmailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => {
        // signOptions.expiresIn resolves to `ms` StringValue | number, a
        // template-literal type a generic config string can't satisfy at
        // compile time. Cast to the exact expected type (not `any`) at this
        // one boundary so the rest of the object stays type-checked.
        type ExpiresIn = NonNullable<
          JwtModuleOptions['signOptions']
        >['expiresIn'];
        const expiresIn = (config.get<string>('JWT_EXPIRES_IN') ??
          '15m') as ExpiresIn;
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
    { provide: AUTH_TOKEN_REPOSITORY, useClass: AuthTokenTypeOrmRepository },
    { provide: LOGIN_ATTEMPT_LIMITER, useClass: RedisLoginAttemptLimiter },
    {
      provide: AUTH_MAIL_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AuthMailConfig => ({
        appBaseUrl: config.get<string>('APP_BASE_URL')?.trim() || undefined,
      }),
    },
    RegisterUserUseCase,
    ForgotPasswordUseCase,
    ResetPasswordUseCase,
    ChangePasswordUseCase,
    LogoutUserUseCase,
    VerifyEmailUseCase,
    ResendVerificationUseCase,
    SendVerificationEmailUseCase,
    SendPasswordResetEmailUseCase,
    AuthMailListener,
    LoginUserUseCase,
    GetUserByIdUseCase,
    GetUserProfileUseCase,
    DisableUserUseCase,
    EnableUserUseCase,
    AcceptAiConsentUseCase,
    WithdrawAiConsentUseCase,
    JwtStrategy,
  ],
  exports: [USER_REPOSITORY, GetUserByIdUseCase],
})
export class UsersModule {}
