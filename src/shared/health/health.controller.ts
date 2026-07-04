import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  MongooseHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health-indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly typeOrm: TypeOrmHealthIndicator,
    private readonly mongoose: MongooseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness check for PostgreSQL, MongoDB, and Redis',
  })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.typeOrm.pingCheck('postgres', { timeout: 3000 }),
      () => this.mongoose.pingCheck('mongodb', { timeout: 3000 }),
      () => this.redis.pingCheck('redis', { timeout: 3000 }),
    ]);
  }
}
