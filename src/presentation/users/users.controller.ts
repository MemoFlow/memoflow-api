import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DisableUserUseCase } from '../../application/users/disable-user.use-case';
import { EnableUserUseCase } from '../../application/users/enable-user.use-case';
import { GetUserProfileUseCase } from '../../application/users/get-user-profile.use-case';
import { UserRole } from '../../domain/users/user-role';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserResponseDto } from './dto/user-response.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly getUserProfileUseCase: GetUserProfileUseCase,
    private readonly disableUserUseCase: DisableUserUseCase,
    private readonly enableUserUseCase: EnableUserUseCase,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getMe(@CurrentUser() user: User): UserResponseDto {
    return UserResponseDto.fromDomain(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by id (self or admin)' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getById(
    @CurrentUser() viewer: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponseDto> {
    const user = await this.getUserProfileUseCase.execute({
      actor: viewer,
      userId: id,
    });
    return UserResponseDto.fromDomain(user, viewer);
  }

  @Post(':id/disable')
  @Roles(UserRole.Admin)
  @HttpCode(204)
  @ApiOperation({ summary: 'Disable a user account (admin only)' })
  @ApiResponse({ status: 204, description: 'Account disabled' })
  @ApiResponse({ status: 400, description: 'Cannot disable your own account' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async disable(
    @CurrentUser() admin: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.disableUserUseCase.execute({
      actorId: admin.id,
      role: admin.role,
      userId: id,
    });
  }

  @Post(':id/enable')
  @Roles(UserRole.Admin)
  @HttpCode(204)
  @ApiOperation({ summary: 'Re-enable a user account (admin only)' })
  @ApiResponse({ status: 204, description: 'Account enabled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async enable(
    @CurrentUser() admin: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.enableUserUseCase.execute({
      actorId: admin.id,
      role: admin.role,
      userId: id,
    });
  }
}
