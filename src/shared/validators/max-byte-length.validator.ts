import { ValidationOptions, registerDecorator } from 'class-validator';

/** bcrypt silently ignores everything past this many bytes. */
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

export function isWithinByteLength(value: unknown, max: number): boolean {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max;
}

/**
 * Validates the UTF-8 byte length (not the character count) of a string.
 * Multibyte characters take 2-4 bytes, so a password under 72 characters can
 * still exceed bcrypt's 72-byte input limit.
 */
export function MaxByteLength(
  max: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'maxByteLength',
      target: object.constructor,
      propertyName: propertyName as string,
      constraints: [max],
      options: {
        message: `$property must be at most ${max} bytes in UTF-8 (multibyte characters count for more than one byte)`,
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) => isWithinByteLength(value, max),
      },
    });
  };
}
