import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LoginUserUseCase } from '../../application/auth/login-user.use-case';
import { RegisterUserUseCase } from '../../application/users/register-user.use-case';
import { LoginUserDto } from '../users/dto/login-user.dto';
import { LoginResponseDto } from '../users/dto/login-response.dto';
import { RegisterUserDto } from '../users/dto/register-user.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUserUseCase: RegisterUserUseCase,
    private readonly loginUserUseCase: LoginUserUseCase,
  ) {}

  // Tight cap on unauthenticated credential endpoints to blunt brute-force /
  // account-enumeration / signup-spam — 5 requests per minute per client IP,
  // well under the global default throttle.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, type: UserResponseDto })
  @ApiResponse({ status: 409, description: 'Email is already registered' })
  async register(@Body() dto: RegisterUserDto): Promise<UserResponseDto> {
    const user = await this.registerUserUseCase.execute({
      email: dto.email,
      password: dto.password,
      displayName: dto.display_name,
    });
    return UserResponseDto.fromDomain(user);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in and receive a JWT access token' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  async login(@Body() dto: LoginUserDto): Promise<LoginResponseDto> {
    const result = await this.loginUserUseCase.execute({
      email: dto.email,
      password: dto.password,
    });
    const response = new LoginResponseDto();
    response.accessToken = result.accessToken;
    return response;
  }
}
