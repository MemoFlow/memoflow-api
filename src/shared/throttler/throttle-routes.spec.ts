/* eslint-disable @typescript-eslint/unbound-method -- reading decorator
   metadata off the method references, never invoking them. */
import { SuggestionsController } from '../../presentation/ai/suggestions.controller';
import { AuthController } from '../../presentation/auth/auth.controller';
import { PlanningJobsController } from '../../presentation/context/planning-jobs.controller';

// The global throttler is skipped under NODE_ENV=test (so the e2e suites aren't
// tripped), which means the real per-route `@Throttle` overrides aren't
// exercised end-to-end. These metadata assertions guard against a typo /
// accidental removal of those caps slipping through CI silently.
// `@Throttle({ default: { limit, ttl } })` stores the values under these keys
// on the handler (see @nestjs/throttler's throttler.decorator / .constants).
const LIMIT_KEY = 'THROTTLER:LIMITdefault';
const TTL_KEY = 'THROTTLER:TTLdefault';
const limitOf = (handler: object): unknown =>
  Reflect.getMetadata(LIMIT_KEY, handler);
const ttlOf = (handler: object): unknown =>
  Reflect.getMetadata(TTL_KEY, handler);

describe('per-route @Throttle overrides', () => {
  it('caps auth register + login at 5 requests / minute', () => {
    expect(limitOf(AuthController.prototype.register)).toBe(5);
    expect(ttlOf(AuthController.prototype.register)).toBe(60_000);
    expect(limitOf(AuthController.prototype.login)).toBe(5);
    expect(ttlOf(AuthController.prototype.login)).toBe(60_000);
  });

  it('caps AI suggestion generation + planning-job submit at 10 / minute', () => {
    expect(limitOf(SuggestionsController.prototype.create)).toBe(10);
    expect(ttlOf(SuggestionsController.prototype.create)).toBe(60_000);
    expect(limitOf(PlanningJobsController.prototype.submit)).toBe(10);
    expect(ttlOf(PlanningJobsController.prototype.submit)).toBe(60_000);
  });
});
