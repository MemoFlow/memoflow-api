import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisterUserDto } from '../../presentation/users/dto/register-user.dto';
import { ChangePasswordDto } from '../../presentation/auth/dto/change-password.dto';
import { LoginUserDto } from '../../presentation/users/dto/login-user.dto';
import { ResetPasswordDto } from '../../presentation/auth/dto/reset-password.dto';
import { isWithinByteLength } from './max-byte-length.validator';

// 40 characters but 80 bytes in UTF-8 (each is 2 bytes).
const MULTIBYTE_OVER = 'é'.repeat(40);
const ASCII_72 = 'a'.repeat(72);

function errorsFor<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
  property: string,
) {
  return validateSync(plainToInstance(cls, plain)).filter(
    (e) => e.property === property,
  );
}

describe('isWithinByteLength', () => {
  it('counts bytes, not characters', () => {
    expect(MULTIBYTE_OVER.length).toBeLessThan(72);
    expect(isWithinByteLength(MULTIBYTE_OVER, 72)).toBe(false);
    expect(isWithinByteLength('é'.repeat(36), 72)).toBe(true);
    expect(isWithinByteLength(ASCII_72, 72)).toBe(true);
    expect(isWithinByteLength(ASCII_72 + 'a', 72)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isWithinByteLength(123, 72)).toBe(false);
  });
});

describe('72-byte password cap on DTOs', () => {
  it.each([
    [
      'RegisterUserDto',
      RegisterUserDto,
      'password',
      { email: 'a@b.com', display_name: 'A' },
    ],
    [
      'ChangePasswordDto',
      ChangePasswordDto,
      'new_password',
      { current_password: 'x' },
    ],
    ['ResetPasswordDto', ResetPasswordDto, 'new_password', { token: 't' }],
  ] as const)(
    '%s rejects a multibyte password under 72 chars but over 72 bytes',
    (_n, cls, field, rest) => {
      const errors = errorsFor(
        cls as new () => object,
        { ...rest, [field]: MULTIBYTE_OVER },
        field,
      );
      expect(errors).toHaveLength(1);
      expect(Object.values(errors[0].constraints ?? {}).join()).toContain(
        '72 bytes',
      );
    },
  );

  it.each([
    [
      'RegisterUserDto',
      RegisterUserDto,
      'password',
      { email: 'a@b.com', display_name: 'A' },
    ],
    [
      'ChangePasswordDto',
      ChangePasswordDto,
      'new_password',
      { current_password: 'x' },
    ],
    ['ResetPasswordDto', ResetPasswordDto, 'new_password', { token: 't' }],
  ] as const)('%s accepts exactly 72 bytes', (_n, cls, field, rest) => {
    expect(
      errorsFor(cls as new () => object, { ...rest, [field]: ASCII_72 }, field),
    ).toHaveLength(0);
  });

  it('LoginUserDto does not cap the password length', () => {
    expect(
      errorsFor(
        LoginUserDto,
        { email: 'a@b.com', password: MULTIBYTE_OVER },
        'password',
      ),
    ).toHaveLength(0);
  });
});
