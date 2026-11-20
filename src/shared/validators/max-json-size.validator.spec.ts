import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MaxJsonSize, isWithinJsonSize } from './max-json-size.validator';

class Probe {
  @MaxJsonSize(20)
  config?: Record<string, unknown>;
}

describe('MaxJsonSize', () => {
  it('measures serialized UTF-8 bytes', () => {
    expect(isWithinJsonSize({ a: 'bc' }, 10)).toBe(true); // {"a":"bc"} = 10
    expect(isWithinJsonSize({ a: 'bcd' }, 10)).toBe(false);
    expect(isWithinJsonSize({ a: 'é' }, 10)).toBe(true); // 2 bytes for é -> 10... boundary
    expect(isWithinJsonSize({ a: 'éé' }, 10)).toBe(false);
  });

  it('treats undefined/null as within the limit and circular values as not', () => {
    expect(isWithinJsonSize(undefined, 1)).toBe(true);
    expect(isWithinJsonSize(null, 1)).toBe(true);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(isWithinJsonSize(circular, 1000)).toBe(false);
  });

  it('works as a decorator at the boundary', async () => {
    const ok = plainToInstance(Probe, { config: { k: 'x'.repeat(12) } }); // exactly 20
    expect(JSON.stringify(ok.config)).toHaveLength(20);
    expect(await validate(ok)).toEqual([]);
    const bad = plainToInstance(Probe, { config: { k: 'x'.repeat(13) } });
    expect(await validate(bad)).not.toEqual([]);
  });
});
