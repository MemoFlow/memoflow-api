import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RecordLeadSignalUseCase } from '../../application/leads/record-lead-signal.use-case';
import { User } from '../../domain/users/user.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RecordLeadSignalDto } from './dto/record-lead-signal.dto';

@ApiTags('lead-signals')
@Controller('lead-signals')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LeadSignalsController {
  constructor(private readonly recordLeadSignal: RecordLeadSignalUseCase) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record a behaviour signal (idempotent scoring)' })
  @ApiResponse({ status: 204, description: 'Recorded (or ignored for admins)' })
  @ApiResponse({ status: 400, description: 'Unknown signal type' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async record(
    @CurrentUser() user: User,
    @Body() dto: RecordLeadSignalDto,
  ): Promise<void> {
    await this.recordLeadSignal.execute({
      userId: user.id,
      role: user.role,
      type: dto.type,
    });
  }
}
