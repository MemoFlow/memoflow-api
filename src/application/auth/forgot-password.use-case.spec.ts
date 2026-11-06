import { EventEmitter2 } from '@nestjs/event-emitter';
import { AUTH_RESET_LINK_REQUESTED_EVENT } from '../../domain/auth/auth-events';
import { ForgotPasswordUseCase } from './forgot-password.use-case';

describe('ForgotPasswordUseCase', () => {
  it('only emits an event with the normalized address', () => {
    const emit = jest.fn();
    const useCase = new ForgotPasswordUseCase({
      emit,
    } as unknown as EventEmitter2);

    const result = useCase.execute({ email: '  Ada@Example.com ' });

    expect(result).toBeUndefined();
    expect(emit).toHaveBeenCalledWith(AUTH_RESET_LINK_REQUESTED_EVENT, {
      email: 'ada@example.com',
      reason: 'forgot_password',
    });
  });
});
