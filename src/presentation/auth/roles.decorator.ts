import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../domain/users/user-role';

export const ROLES_KEY = 'roles';

/** Restricts a route to users holding one of the given roles. Use after `JwtAuthGuard`. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
