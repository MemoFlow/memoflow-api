import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../domain/users/user-role';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

class PlainController {}

function restrictedHandler(): void {}
function openHandler(): void {}
// What `@Roles(UserRole.Admin)` writes onto a handler.
Roles(UserRole.Admin)({}, 'restricted', {
  value: restrictedHandler,
} as PropertyDescriptor);

function makeContext(
  handler: () => void,
  user: { role: string } | undefined,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => PlainController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a user holding a required role', () => {
    const context = makeContext(restrictedHandler, { role: 'admin' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when the role is missing', () => {
    const context = makeContext(restrictedHandler, { role: 'user' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when there is no authenticated user', () => {
    const context = makeContext(restrictedHandler, undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows a route that declares no roles', () => {
    const context = makeContext(openHandler, { role: 'user' });
    expect(guard.canActivate(context)).toBe(true);
  });
});
