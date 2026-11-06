import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '../../domain/users/user.entity';
import { GetUserByIdUseCase } from './get-user-by-id.use-case';

export interface GetUserProfileInput {
  actor: User;
  userId: string;
}

/**
 * A user may read their own record; an admin may read any. Everyone else
 * gets the same 404 as for a missing id.
 */
@Injectable()
export class GetUserProfileUseCase {
  constructor(private readonly getUserById: GetUserByIdUseCase) {}

  async execute(input: GetUserProfileInput): Promise<User> {
    if (input.actor.id !== input.userId && !input.actor.isAdmin) {
      throw new NotFoundException(`User ${input.userId} not found`);
    }
    return this.getUserById.execute(input.userId);
  }
}
