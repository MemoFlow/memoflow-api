import { ValidationOptions, registerDecorator } from 'class-validator';

/** Default cap for free-form JSON objects (e.g. `styleConfig`). */
export const MAX_JSON_OBJECT_BYTES = 10_240;

export function isWithinJsonSize(value: unknown, max: number): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  try {
    const serialized = JSON.stringify(value);
    return (
      serialized !== undefined && Buffer.byteLength(serialized, 'utf8') <= max
    );
  } catch {
    return false;
  }
}

/** Caps the serialized (UTF-8) JSON size of a free-form object. */
export function MaxJsonSize(
  max: number = MAX_JSON_OBJECT_BYTES,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'maxJsonSize',
      target: object.constructor,
      propertyName: propertyName as string,
      constraints: [max],
      options: {
        message: `$property must serialize to at most ${max} bytes of JSON`,
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) => isWithinJsonSize(value, max),
      },
    });
  };
}
