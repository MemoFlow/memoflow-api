import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../../domain/users/user-role';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';

export interface EnableUserInput {
  actorId: string;
  role: UserRole;
  userId: string;
}

/**
 * Admin-only (also enforced at the controller). Idempotent: enabling an account
 * that is already enabled succeeds without change.
 */
@Injectable()
export class EnableUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
  ) {}

  async execute(input: EnableUserInput): Promise<void> {
    if (input.role !== UserRole.Admin) {
      throw new ForbiddenException('Admin role required');
    }
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new NotFoundException(`User ${input.userId} not found`);
    }
    if (!user.isDisabled) {
      return;
    }
    await this.userRepository.setDisabledAt(user.id, null);
  }
}
