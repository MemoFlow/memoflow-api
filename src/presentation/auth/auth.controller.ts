import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ChangePasswordUseCase } from '../../application/auth/change-password.use-case';
import { ForgotPasswordUseCase } from '../../application/auth/forgot-password.use-case';
import { LoginUserUseCase } from '../../application/auth/login-user.use-case';
import { LoginThrottledException } from '../../application/auth/login-throttled.exception';
import { LogoutUserUseCase } from '../../application/auth/logout-user.use-case';
import { ResendVerificationUseCase } from '../../application/auth/resend-verification.use-case';
import { ResetPasswordUseCase } from '../../application/auth/reset-password.use-case';
import { VerifyEmailUseCase } from '../../application/auth/verify-email.use-case';
import { RegisterUserUseCase } from '../../application/users/register-user.use-case';
import { User } from '../../domain/users/user.entity';
import { LoginUserDto } from '../users/dto/login-user.dto';
import { LoginResponseDto } from '../users/dto/login-response.dto';
import { RegisterUserDto } from '../users/dto/register-user.dto';
import { CurrentUser } from './current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

// Tight cap on unauthenticated credential endpoints to blunt brute-force /
// account-enumeration / signup-spam: 5 requests per minute per client IP,
// well under the global default throttle.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUserUseCase: RegisterUserUseCase,
    private readonly loginUserUseCase: LoginUserUseCase,
    private readonly forgotPasswordUseCase: ForgotPasswordUseCase,
    private readonly resetPasswordUseCase: ResetPasswordUseCase,
    private readonly changePasswordUseCase: ChangePasswordUseCase,
    private readonly verifyEmailUseCase: VerifyEmailUseCase,
    private readonly resendVerificationUseCase: ResendVerificationUseCase,
    private readonly logoutUserUseCase: LogoutUserUseCase,
  ) {}

  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Always answers 202 with the same body, whether or not the address already has an account; a verification (or "you already have an account") email is sent instead.',
  })
  @ApiResponse({ status: 202, type: MessageResponseDto })
  async register(@Body() dto: RegisterUserDto): Promise<MessageResponseDto> {
    await this.registerUserUseCase.execute({
      email: dto.email,
      password: dto.password,
      displayName: dto.display_name,
    });
    return MessageResponseDto.of(
      'If the address can be registered, an email has been sent to continue.',
    );
  }

  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in and receive a JWT access token' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @ApiResponse({
    status: 429,
    description:
      'Too many login attempts for this account (10 per 15 minutes); see the Retry-After header (seconds)',
  })
  async login(
    @Body() dto: LoginUserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    let result: { accessToken: string };
    try {
      result = await this.loginUserUseCase.execute({
        email: dto.email,
        password: dto.password,
      });
    } catch (err) {
      if (err instanceof LoginThrottledException) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      throw err;
    }
    const response = new LoginResponseDto();
    response.accessToken = result.accessToken;
    return response;
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Log out of all sessions',
    description:
      'Access tokens are stateless, so logging out revokes every session of the user: all access tokens issued so far stop working and their live WebSocket connections are closed. Not just the current device.',
  })
  @ApiResponse({ status: 204, description: 'All sessions ended' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(@CurrentUser() user: User): Promise<void> {
    await this.logoutUserUseCase.execute({ userId: user.id });
  }

  @Throttle(AUTH_THROTTLE)
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'Always answers 202, whether or not the address has an account.',
  })
  @ApiResponse({ status: 202, type: MessageResponseDto })
  forgotPassword(@Body() dto: ForgotPasswordDto): MessageResponseDto {
    this.forgotPasswordUseCase.execute({ email: dto.email });
    return MessageResponseDto.of(
      'If the address has an account, a reset email has been sent.',
    );
  }

  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password using an emailed token' })
  @ApiResponse({ status: 204, description: 'Password updated' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.resetPasswordUseCase.execute({
      token: dto.token,
      newPassword: dto.new_password,
    });
  }

  @Throttle(AUTH_THROTTLE)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change the password and receive a fresh access token',
  })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 400, description: 'Current password is incorrect' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
  ): Promise<LoginResponseDto> {
    const result = await this.changePasswordUseCase.execute({
      user,
      currentPassword: dto.current_password,
      newPassword: dto.new_password,
    });
    const response = new LoginResponseDto();
    response.accessToken = result.accessToken;
    return response;
  }

  @Throttle(AUTH_THROTTLE)
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Verify the email address using an emailed token' })
  @ApiResponse({ status: 204, description: 'Email verified' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    await this.verifyEmailUseCase.execute({ token: dto.token });
  }

  @Throttle(AUTH_THROTTLE)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request another verification email',
    description:
      'Always answers 202; nothing is sent when the address is already verified or a message was sent recently.',
  })
  @ApiResponse({ status: 202, type: MessageResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  resendVerification(@CurrentUser() user: User): MessageResponseDto {
    this.resendVerificationUseCase.execute({ user });
    return MessageResponseDto.of(
      'If the address is unverified, a verification email has been sent.',
    );
  }
}
