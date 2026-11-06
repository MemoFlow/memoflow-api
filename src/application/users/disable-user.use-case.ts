import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { USER_DISABLED_EVENT } from '../../domain/users/user-events';
import type { UserDisabledEventPayload } from '../../domain/users/user-events';
import { UserRole } from '../../domain/users/user-role';
import { USER_REPOSITORY } from '../../domain/users/user.repository';
import type { UserRepository } from '../../domain/users/user.repository';

export interface DisableUserInput {
  actorId: string;
  role: UserRole;
  userId: string;
}

/**
 * Admin-only (also enforced at the controller). Idempotent: disabling an account
 * that is already disabled keeps its timestamp (the eviction event is still
 * emitted).
 */
@Injectable()
export class DisableUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(input: DisableUserInput): Promise<void> {
    if (input.role !== UserRole.Admin) {
      throw new ForbiddenException('Admin role required');
    }
    if (input.actorId === input.userId) {
      throw new BadRequestException('You cannot disable your own account');
    }
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new NotFoundException(`User ${input.userId} not found`);
    }
    // An already-disabled account keeps its original `disabled_at`, but the
    // event is still emitted so repeating the call forces eviction of any
    // live connections.
    if (!user.isDisabled) {
      await this.userRepository.setDisabledAt(user.id, new Date());
    }
    // Lets live connections (e.g. the planning WebSocket gateway) drop the
    // account's sessions.
    const payload: UserDisabledEventPayload = { userId: user.id };
    this.eventEmitter.emit(USER_DISABLED_EVENT, payload);
  }
}
