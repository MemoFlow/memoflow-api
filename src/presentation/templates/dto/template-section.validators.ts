import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'wordCountRangeValid', async: false })
export class WordCountRangeValidConstraint implements ValidatorConstraintInterface {
  validate(wordCountMax: unknown, args: ValidationArguments): boolean {
    const object = args.object as { wordCountMin?: unknown };
    // Let @IsInt/@Min on the individual fields report the real error when
    // either value isn't a number yet.
    if (
      typeof object.wordCountMin !== 'number' ||
      typeof wordCountMax !== 'number'
    ) {
      return true;
    }
    return object.wordCountMin <= wordCountMax;
  }

  defaultMessage(): string {
    return 'wordCountMax must be greater than or equal to wordCountMin';
  }
}

/** Applied to `wordCountMax`: rejects `wordCountMin > wordCountMax`. */
export function WordCountRangeValid(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [],
      validator: WordCountRangeValidConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'uniqueSectionOrders', async: false })
export class UniqueSectionOrdersConstraint implements ValidatorConstraintInterface {
  validate(sections: unknown): boolean {
    // Let @IsArray report the real error when it isn't an array yet.
    if (!Array.isArray(sections)) {
      return true;
    }
    const orders = sections
      .map((section: unknown) => (section as { order?: unknown })?.order)
      .filter((order): order is number => typeof order === 'number');
    return new Set(orders).size === orders.length;
  }

  defaultMessage(): string {
    return 'sections must not contain duplicate order values';
  }
}

/** Applied to `sections`: rejects duplicate `order` values within the array. */
export function UniqueSectionOrders(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [],
      validator: UniqueSectionOrdersConstraint,
    });
  };
}
