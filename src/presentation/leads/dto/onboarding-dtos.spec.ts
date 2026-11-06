import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RecordLeadSignalDto } from './record-lead-signal.dto';
import { SubmitOnboardingDto } from './submit-onboarding.dto';
import { UpdateConsentDto } from './update-consent.dto';

// Exactly the options in src/main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const validBody = (): Record<string, unknown> => ({
  persona: 'apprentice',
  deliverable_type: 'apprenticeship_report',
  due_date: '2027-01-15',
  academic_level: 'm2',
  school_name: 'ESGI',
  work_tools: ['trello', 'email'],
  blockers: ['finding_past_work'],
  acquisition_channel: 'friend',
  marketing_opt_in: true,
});

const submit = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: SubmitOnboardingDto });

describe('SubmitOnboardingDto', () => {
  it('accepts a valid body', async () => {
    await expect(submit(validBody())).resolves.toMatchObject({
      marketing_opt_in: true,
      school_name: 'ESGI',
    });
  });

  it.each(['false', 'true', 'FALSE', '0', 1, 0, null])(
    'rejects non-boolean marketing_opt_in %p with 400 (implicit conversion must not coerce)',
    async (value) => {
      await expect(
        submit({ ...validBody(), marketing_opt_in: value }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('keeps a real boolean false as false', async () => {
    const dto = await submit({ ...validBody(), marketing_opt_in: false });
    expect(dto.marketing_opt_in).toBe(false);
  });

  it('rejects a missing marketing_opt_in', async () => {
    const body = validBody();
    delete body.marketing_opt_in;
    await expect(submit(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['trello', 'trello,email', {}, 5, null])(
    'rejects work_tools given as non-array %p',
    async (value) => {
      await expect(
        submit({ ...validBody(), work_tools: value }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('accepts an empty work_tools but requires the field', async () => {
    await expect(
      submit({ ...validBody(), work_tools: [] }),
    ).resolves.toBeDefined();
    const body = validBody();
    delete body.work_tools;
    await expect(submit(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicates in work_tools and blockers', async () => {
    await expect(
      submit({ ...validBody(), work_tools: ['trello', 'trello'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      submit({ ...validBody(), blockers: ['writing', 'writing'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects empty or unknown blockers and unknown work tools', async () => {
    await expect(
      submit({ ...validBody(), blockers: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      submit({ ...validBody(), blockers: ['nope'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      submit({ ...validBody(), work_tools: ['nope'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([null, undefined, '', '   '])(
    'maps school_name %p to null/absent',
    async (value) => {
      const dto = await submit({ ...validBody(), school_name: value });
      expect(dto.school_name ?? null).toBeNull();
    },
  );

  it('trims school_name and caps it at 120 characters', async () => {
    const dto = await submit({ ...validBody(), school_name: '  ESGI  ' });
    expect(dto.school_name).toBe('ESGI');
    await expect(
      submit({ ...validBody(), school_name: 'x'.repeat(121) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      submit({ ...validBody(), school_name: 'x'.repeat(120) }),
    ).resolves.toBeDefined();
  });

  it('rejects a non-string school_name instead of coercing it', async () => {
    await expect(
      submit({ ...validBody(), school_name: 123 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    '2027-02-30',
    '2027-13-01',
    '2027-1-15',
    '2027-01-15T00:00:00Z',
    'x',
  ])('rejects invalid due_date %p', async (value) => {
    await expect(
      submit({ ...validBody(), due_date: value }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a leap-day due_date', async () => {
    await expect(
      submit({ ...validBody(), due_date: '2028-02-29' }),
    ).resolves.toBeDefined();
  });

  it('rejects unknown enum values', async () => {
    await expect(
      submit({ ...validBody(), persona: 'wizard' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UpdateConsentDto', () => {
  const consent = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: UpdateConsentDto });

  it.each(['false', 'true', 0, 1, null, undefined])(
    'rejects non-boolean marketing_opt_in %p with 400',
    async (value) => {
      await expect(consent({ marketing_opt_in: value })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('accepts real booleans and preserves false', async () => {
    expect((await consent({ marketing_opt_in: false })).marketing_opt_in).toBe(
      false,
    );
    expect((await consent({ marketing_opt_in: true })).marketing_opt_in).toBe(
      true,
    );
  });
});

describe('RecordLeadSignalDto', () => {
  const record = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: RecordLeadSignalDto });

  it('accepts the known type and rejects unknown ones', async () => {
    await expect(record({ type: 'export_paywall_hit' })).resolves.toBeDefined();
    await expect(record({ type: 'nope' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
