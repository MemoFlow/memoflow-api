import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto } from '../../auth/dto/change-password.dto';
import { ForgotPasswordDto } from '../../auth/dto/forgot-password.dto';
import { LoginUserDto } from './login-user.dto';
import { RegisterUserDto } from './register-user.dto';

describe('identity DTO size limits', () => {
  it('accepts an email at 254 characters and rejects 255', async () => {
    // class-validator's IsEmail itself caps the local part at 64, so build
    // the length with a long (but valid) domain instead.
    const label = 'b'.repeat(63);
    const at254 = `user@${label}.${label}.${label}.${'c'.repeat(254 - 5 - 63 * 3 - 3)}`;
    expect(at254).toHaveLength(254);
    const over = `${at254}c`;
    for (const cls of [LoginUserDto, ForgotPasswordDto]) {
      const ok = await validate(
        plainToInstance(cls, { email: at254, password: 'x' }),
      );
      expect(ok.find((e) => e.property === 'email')).toBeUndefined();
      const bad = await validate(
        plainToInstance(cls, { email: over, password: 'x' }),
      );
      expect(
        bad.find((e) => e.property === 'email')?.constraints,
      ).toHaveProperty('maxLength');
    }
  });

  it('caps register display_name at 200 characters', async () => {
    const base = {
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
    };
    expect(
      await validate(
        plainToInstance(RegisterUserDto, {
          ...base,
          display_name: 'n'.repeat(200),
        }),
      ),
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(RegisterUserDto, {
          ...base,
          display_name: 'n'.repeat(201),
        }),
      ),
    ).not.toEqual([]);
  });

  it('keeps the 72-byte cap on new passwords', async () => {
    const dto = (len: number) =>
      plainToInstance(RegisterUserDto, {
        email: 'ada@example.com',
        display_name: 'Ada',
        password: 'p'.repeat(len),
      });
    expect(await validate(dto(72))).toEqual([]);
    expect(await validate(dto(73))).not.toEqual([]);
  });

  it('bounds login and current passwords at 1024 characters', async () => {
    expect(
      await validate(
        plainToInstance(LoginUserDto, {
          email: 'ada@example.com',
          password: 'p'.repeat(1024),
        }),
      ),
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(LoginUserDto, {
          email: 'ada@example.com',
          password: 'p'.repeat(1025),
        }),
      ),
    ).not.toEqual([]);
    expect(
      await validate(
        plainToInstance(ChangePasswordDto, {
          current_password: 'p'.repeat(1025),
          new_password: 'correct-horse-battery-staple',
        }),
      ),
    ).not.toEqual([]);
  });
});
