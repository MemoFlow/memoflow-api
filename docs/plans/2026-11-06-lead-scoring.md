# Onboarding and Lead Scoring Implementation Plan

> **For agentic workers:** Execute task by task through the `implementer` agent, per the
> pipeline in `CLAUDE.md`. Steps use checkbox syntax. Task state lives in
> `2026-11-06-lead-scoring.md.tasks.json`; update it with `docs/ROADMAP.md` on each completion.

**Goal:** Store onboarding answers, convert them and behaviour signals into a stored lead score, and expose leads, suggested actions and stats to admins.

**Architecture:** One PG-backed `leads` vertical slice. A pure domain scorer turns facts into points; `RecalculateLeadScoreUseCase` is the only writer of `lead_scores`. Submit and signal routes call it directly; connector status changes reach it through `EventEmitter2` and a swallow-and-log listener.

**Tech Stack:** NestJS 11, TypeORM 1 (PostgreSQL), class-validator, `@nestjs/event-emitter`, Jest, Testcontainers.

**Spec:** `docs/contracts/lead-scoring.md` is authoritative for routes, shapes and status codes.

## Global Constraints

- Follow the contract exactly; do not add response fields.
- Score, tier, breakdown and suggested action never appear in a user route response.
- `src/domain` imports nothing from other layers. Only `src/infrastructure/persistence` imports `typeorm`.
- All tables live in PG. `synchronize` stays false; a migration ships in the same commit as its entities.
- Controllers call use-cases only. Listener errors are swallowed, logged and sent to Sentry, as in `GamificationListener`.

**User decisions (already made):**
- Score and tier are admin-only.
- Scope: storage, scoring, admin lead list, per-lead breakdown, aggregate stats.
- Marketing consent is an explicit opt-in with a stored timestamp.
- School autocomplete is frontend-owned; the API stores optional free text.
- Answers arrive in one submit (`PUT /onboarding/me`), not per screen.
- The score is stored, not computed on read. No scheduler.
- Suggested solutions are one admin-facing action per tier.

## Review Focus

- A JSON string `"false"` for `marketing_opt_in`: expect `400`, because implicit conversion would otherwise record consent as `true`. Test in Task 2.
- Reconnecting a connector that was active: the row returns to `initiated`, so the score must drop. Test in Task 3.
- A user whose stored `due_date` has passed and who resubmits or withdraws consent: expect `200`. Test in Task 2.
- A user with an active connector before this feature ships: expect the migration backfill to score them. Test in Task 1.
- `?marketing_opt_in=false` on `GET /leads`: expect only non-opted-in leads, not an inverted filter. Test in Task 4.

---

### Task 0: Domain types and pure scorer

**Goal:** Enums, onboarding entity, and pure functions for score, tier, suggested action and stats.

**Files:**
- Create: `src/domain/leads/lead-enums.ts`, `src/domain/leads/onboarding-profile.entity.ts`, `src/domain/leads/lead-score.ts`, `src/domain/leads/lead-stats.ts`
- Test: `src/domain/leads/lead-score.spec.ts`, `src/domain/leads/lead-stats.spec.ts`

**Acceptance Criteria:**
- [ ] Every rule in the contract's scoring table fires with its listed points
- [ ] 3- and 6-month boundaries, today, past dates and 30 Nov + 3 months = 28 Feb behave as the contract says
- [ ] Tier edges 3/4/7/8 and a maximum of 13 are covered
- [ ] Without opt-in, `suggestedAction` returns `no_outreach` for every tier
- [ ] `computeLeadStats` zero-fills every enum key

**Verify:** `npm test -- src/domain/leads` → all tests pass

**Steps:**

- [ ] **Step 1: Write failing table tests** for the criteria above, with `now` fixed as `new Date('2026-11-30T12:00:00Z')` for the month-end case.
- [ ] **Step 2: Implement.** Enum string values come verbatim from the contract's Enums section. Scorer:

```ts
export interface LeadScoreFacts {
  persona: Persona | null;
  dueDate: string | null; // YYYY-MM-DD
  workTools: WorkTool[] | null;
  hasActiveConnector: boolean;
  hasPaywallSignal: boolean;
}

export interface ScoreBreakdownEntry { rule: ScoreRule; points: number }

export const toUtcDate = (d: Date): string => d.toISOString().slice(0, 10);

export function addCalendarMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return toUtcDate(target);
}

export function computeLeadScore(facts: LeadScoreFacts, now: Date) {
  const today = toUtcDate(now);
  const breakdown: ScoreBreakdownEntry[] = [];
  const add = (rule: ScoreRule, points: number) => breakdown.push({ rule, points });
  if (facts.dueDate && facts.dueDate >= today) {
    if (facts.dueDate < addCalendarMonths(today, 3)) add(ScoreRule.DueWithin3Months, 3);
    else if (facts.dueDate <= addCalendarMonths(today, 6)) add(ScoreRule.DueWithin3To6Months, 2);
  }
  if (facts.persona === Persona.Apprentice) add(ScoreRule.PersonaApprentice, 2);
  if (facts.persona === Persona.Intern) add(ScoreRule.PersonaIntern, 1);
  if (facts.workTools?.includes(WorkTool.Trello)) add(ScoreRule.CitedTrello, 2);
  if (facts.hasActiveConnector) add(ScoreRule.ConnectedTool, 3);
  if (facts.hasPaywallSignal) add(ScoreRule.ExportPaywallHit, 3);
  const score = breakdown.reduce((sum, entry) => sum + entry.points, 0);
  return { score, tier: tierForScore(score), breakdown };
}

export const tierForScore = (score: number): LeadTier =>
  score >= 8 ? LeadTier.Hot : score >= 4 ? LeadTier.Warm : LeadTier.Cold;

const ACTION_BY_TIER: Record<LeadTier, SuggestedAction> = {
  [LeadTier.Hot]: SuggestedAction.InterviewAndProOffer,
  [LeadTier.Warm]: SuggestedAction.ScheduledEmails,
  [LeadTier.Cold]: SuggestedAction.Newsletter,
};

export const suggestedAction = (tier: LeadTier, optIn: boolean): SuggestedAction =>
  optIn ? ACTION_BY_TIER[tier] : SuggestedAction.NoOutreach;
```

`computeLeadStats(rows: LeadRow[], now: Date)` takes the `LeadRow` read model defined in `lead-read.repository.ts` (Task 1) and returns the stats shape from the contract, as a plain object with camelCase keys, counting users. Define `LeadRow` in `lead-stats.ts` if Task 1 is not yet present, then import it from there.

- [ ] **Step 3: Run tests; commit.**

```json:metadata
{"files": ["src/domain/leads/"], "verifyCommand": "npm test -- src/domain/leads", "acceptanceCriteria": ["all scoring rules, boundaries and tier edges covered", "no_outreach without opt-in", "stats zero-filled"], "modelTier": "mechanical"}
```

### Task 1: Tables, migration and repositories

**Goal:** Three new PG tables with a backfill migration and repositories behind domain ports.

**Files:**
- Create: `src/domain/leads/onboarding-profile.repository.ts`, `lead-signal.repository.ts`, `lead-score.repository.ts`, `lead-read.repository.ts`
- Create: `src/infrastructure/persistence/leads/*.orm-entity.ts`, `*.typeorm.repository.ts`
- Create: `src/infrastructure/persistence/migrations/<timestamp>-CreateLeadScoring.ts`
- Test: repository behaviour is covered through `test/leads.e2e-spec.ts`

**Acceptance Criteria:**
- [ ] `onboarding_profiles`, `lead_signals` and `lead_scores` match `docs/database-schema.md`, each with `user_id` FK to `users` ON DELETE CASCADE
- [ ] `marketing_opt_in_at` changes only on first insert or when the value differs, enforced in SQL
- [ ] Repeated `lead_signals` writes keep one row per `(user_id, type)` and increment `occurrences`
- [ ] A slower recalculation never overwrites a newer `lead_scores` row
- [ ] Migration backfills users with an active connector at score 3, `cold`; `migration:revert` drops all three tables

**Verify:** `npm run migration:run && npm run migration:revert && npm run migration:run` → all succeed on a clean DB

**Steps:**

- [ ] **Step 1: Entities.**
  - `onboarding_profiles`: `user_id` uuid PK; `persona`, `deliverable_type`, `academic_level`, `acquisition_channel` varchar; `due_date` date; `school_name` varchar(120) nullable; `work_tools`, `blockers` text[]; `marketing_opt_in` boolean default false; `marketing_opt_in_at` timestamptz; `submitted_at` timestamptz; `created_at`, `updated_at`.
  - `lead_signals`: uuid PK; `user_id`; `type` varchar; `first_seen_at`, `last_seen_at` timestamptz; `occurrences` int default 1; unique `(user_id, type)`.
  - `lead_scores`: `user_id` uuid PK; `score` int; `tier` varchar with CHECK in (`hot`,`warm`,`cold`), indexed; `breakdown` jsonb; `computed_at` timestamptz. Index on `score`.
- [ ] **Step 2: Ports.**

```ts
interface OnboardingProfileRepository {
  findByUserId(userId: string): Promise<OnboardingProfile | null>;
  upsert(data: SubmitOnboardingData, now: Date): Promise<OnboardingProfile>;
  /** null when the user has no row. */
  updateConsent(userId: string, optIn: boolean, now: Date): Promise<OnboardingProfile | null>;
}
interface LeadSignalRepository {
  record(userId: string, type: LeadSignalType, now: Date): Promise<void>;
  findByUserId(userId: string): Promise<LeadSignal[]>;
}
interface LeadScoreRepository {
  /** Keeps the row unless a newer computed_at is already stored. */
  saveIfNewer(userId: string, result: LeadScoreResult, computedAt: Date): Promise<void>;
}
interface LeadReadRepository {
  list(filter: LeadListFilter, today: string): Promise<{ rows: LeadRow[]; total: number }>;
  findEligibleByUserId(userId: string): Promise<LeadRow | null>;
  findAllEligible(): Promise<LeadRow[]>;
}
```

- [ ] **Step 3: Implement.** `upsert` uses `INSERT ... ON CONFLICT (user_id) DO UPDATE` with `marketing_opt_in_at = CASE WHEN onboarding_profiles.marketing_opt_in IS DISTINCT FROM EXCLUDED.marketing_opt_in THEN EXCLUDED.marketing_opt_in_at ELSE onboarding_profiles.marketing_opt_in_at END`. `updateConsent` applies the same rule. `saveIfNewer` uses `ON CONFLICT DO UPDATE ... WHERE lead_scores.computed_at <= EXCLUDED.computed_at`.

`LeadReadRepository` reads `users` LEFT JOIN `onboarding_profiles` and `lead_scores`, with `EXISTS` subqueries on `connector_connections` (status `active`) and `lead_signals`, through the shared `DataSource`, as gamification repositories do. Eligible means `role = 'user' AND disabled_at IS NULL`. Missing scores read as `COALESCE(score, 0)`, `COALESCE(tier, 'cold')`. Order: `score DESC, (due_date >= today) DESC NULLS LAST, due_date ASC NULLS LAST, id ASC`.

- [ ] **Step 4: Migration.** Generate with `npm run migration:generate`, prune unrelated noise as `AddUserDisabledAt` documents, then append the backfill:

```sql
INSERT INTO lead_scores (user_id, score, tier, breakdown, computed_at)
SELECT DISTINCT c.user_id, 3, 'cold', '[{"rule":"connected_tool","points":3}]'::jsonb, now()
FROM connector_connections c JOIN users u ON u.id = c.user_id
WHERE c.status = 'active';
```

- [ ] **Step 5: Run the migration round trip; commit.**

```json:metadata
{"files": ["src/domain/leads/", "src/infrastructure/persistence/leads/", "src/infrastructure/persistence/migrations/"], "verifyCommand": "npm run migration:run && npm run migration:revert && npm run migration:run", "acceptanceCriteria": ["tables match schema doc", "opt-in timestamp rule enforced in SQL", "signals one row per user and type", "older recalculation cannot overwrite newer", "backfill scores active connectors"], "modelTier": "standard"}
```

### Task 2: Onboarding routes and score recalculation

**Goal:** `GET /onboarding/me`, `PUT /onboarding/me`, `PUT /onboarding/me/consent`, `POST /lead-signals`, plus the recalculation use-case they call.

**Files:**
- Create: `src/application/leads/get-onboarding.use-case.ts`, `submit-onboarding.use-case.ts`, `update-consent.use-case.ts`, `record-lead-signal.use-case.ts`, `recalculate-lead-score.use-case.ts` (each with `.spec.ts`)
- Create: `src/presentation/leads/onboarding.controller.ts`, `lead-signals.controller.ts`, `dto/submit-onboarding.dto.ts`, `dto/update-consent.dto.ts`, `dto/record-lead-signal.dto.ts`, `dto/onboarding-response.dto.ts`
- Create: `src/leads.module.ts`; Modify: `src/app.module.ts`

**Acceptance Criteria:**
- [ ] Every status code and validation rule in the contract's User routes section holds
- [ ] `marketing_opt_in: "false"` gets `400` on both PUT routes
- [ ] A due date equal to the stored value is accepted even when past; a changed one before yesterday (UTC) gets `400`
- [ ] Consent before first submit gets `409`; consent never changes `lead_scores`
- [ ] Admin signal calls return `204` and store nothing
- [ ] No user route response contains `score`, `tier`, `breakdown` or `suggested_action`

**Verify:** `npm test -- src/application/leads` → all tests pass

**Steps:**

- [ ] **Step 1: Write failing use-case specs** with in-memory fakes of the Task 1 ports and `ConnectorConnectionRepository`.
- [ ] **Step 2: Recalculation.** Take `computedAt = new Date()` **before** reading so the later-started run wins:

```ts
async execute(userId: string): Promise<void> {
  const computedAt = new Date();
  const [profile, connectors, signals] = await Promise.all([
    this.profiles.findByUserId(userId),
    this.connectors.findActiveByUser(userId),
    this.signals.findByUserId(userId),
  ]);
  const result = computeLeadScore(
    {
      persona: profile?.persona ?? null,
      dueDate: profile?.dueDate ?? null,
      workTools: profile?.workTools ?? null,
      hasActiveConnector: connectors.length > 0,
      hasPaywallSignal: signals.some((s) => s.type === LeadSignalType.ExportPaywallHit),
    },
    computedAt,
  );
  await this.scores.saveIfNewer(userId, result, computedAt);
}
```

- [ ] **Step 3: DTOs.** `main.ts` enables implicit conversion, so a raw `"false"` would become `true`. Read the raw value:

```ts
@Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
@IsBoolean()
marketing_opt_in: boolean;
```

`due_date`: `@Matches(/^\d{4}-\d{2}-\d{2}$/)` and `@IsISO8601({ strict: true })`. `school_name`: `@Transform` trims and maps blank to `null`, then `@IsOptional`, `@IsString`, `@MaxLength(120)`. `work_tools`: `@IsArray`, `@ArrayUnique`, `@IsEnum(WorkTool, { each: true })`. `blockers`: the same plus `@ArrayMinSize(1)`. Add `@ApiProperty` to every field.

- [ ] **Step 4: Controllers and module.** `@HttpCode(204)` on signals. `LeadsModule` imports `UsersModule` and `ConnectorsModule`; export `CONNECTOR_CONNECTION_REPOSITORY` from `ConnectorsModule` if it does not already.
- [ ] **Step 5: Run tests, lint and build; commit.**

```json:metadata
{"files": ["src/application/leads/", "src/presentation/leads/", "src/leads.module.ts", "src/app.module.ts"], "verifyCommand": "npm test -- src/application/leads", "acceptanceCriteria": ["contract user routes hold", "string false rejected", "conditional due date rule", "consent 409 before submit", "admin signals ignored", "no score fields on user routes"], "modelTier": "standard"}
```

### Task 3: Recalculate on connector status changes

**Goal:** Any connector status change recalculates the owner's score without ever failing the originating request.

**Files:**
- Create: `src/domain/connectors/connector-events.ts`, `src/presentation/leads/lead-score.listener.ts` (+ `.spec.ts`)
- Modify: `src/application/connectors/sync-connection-status.use-case.ts`, the initiate-connection use-case that calls `upsertInitiated`, and their specs; `src/leads.module.ts`

**Acceptance Criteria:**
- [ ] `connector.status_changed` is emitted with `{ userId }` after a real status change in `applyStatus`, and not on a no-op or terminal-state refusal
- [ ] Reconnecting a previously active connection emits it after `upsertInitiated`
- [ ] The listener also handles the existing `CONNECTOR_REVOKED_EVENT`
- [ ] A recalculation failure is logged and sent to Sentry, and does not propagate

**Verify:** `npm test -- src/application/connectors src/presentation/leads` → all tests pass

**Steps:**

- [ ] **Step 1: Write failing specs** for the emit and no-emit paths and for the listener's swallow path.
- [ ] **Step 2: Add the event and emit it.**

```ts
export const CONNECTOR_STATUS_CHANGED_EVENT = 'connector.status_changed';
export interface ConnectorStatusChangedEventPayload { userId: string }
```

Inject `EventEmitter2` into `SyncConnectionStatusUseCase`. In `applyStatus`, emit after `updateStatus` returns. Note `reconcile` runs on read, so a list call can trigger this; that is intended.

- [ ] **Step 3: Listener.** Mirror `GamificationListener.safeHandle`: a plain provider with `@OnEvent` methods for both events, wrapping `RecalculateLeadScoreUseCase.execute` in try/catch with `logger.error` and `Sentry.captureException`.
- [ ] **Step 4: Run tests; commit.**

```json:metadata
{"files": ["src/domain/connectors/connector-events.ts", "src/application/connectors/", "src/presentation/leads/lead-score.listener.ts"], "verifyCommand": "npm test -- src/application/connectors src/presentation/leads", "acceptanceCriteria": ["event on real status change only", "reconnect emits", "revoke handled", "failures swallowed and reported"], "modelTier": "standard"}
```

### Task 4: Admin routes

**Goal:** `GET /leads`, `GET /leads/stats` and `GET /leads/:id` for admins.

**Files:**
- Create: `src/application/leads/list-leads.use-case.ts`, `get-lead.use-case.ts`, `get-lead-stats.use-case.ts` (each with `.spec.ts`)
- Create: `src/presentation/leads/leads.controller.ts`, `dto/list-leads-query.dto.ts`, `dto/lead-summary-response.dto.ts`, `dto/lead-detail-response.dto.ts`, `dto/lead-stats-response.dto.ts`
- Modify: `src/leads.module.ts`

**Acceptance Criteria:**
- [ ] Non-admins get `403` on all three routes
- [ ] `GET /leads/stats` reaches the stats handler, not `:id`
- [ ] `?marketing_opt_in=false` returns only non-opted-in leads; `?marketing_opt_in=abc` gets `400`
- [ ] `page` and `limit` clamp as the contract says, and the response returns the applied values
- [ ] `suggested_action` reflects current opt-in, including after a consent change with no recalculation
- [ ] Admin, disabled and unknown ids get `404` on `GET /leads/:id`

**Verify:** `npm test -- src/application/leads` → all tests pass

**Steps:**

- [ ] **Step 1: Write failing specs** for clamping, filter parsing and summary mapping.
- [ ] **Step 2: Query DTO.** Declare boolean filters as `string` with `@IsIn(['true', 'false'])` and convert in the controller. Declare `page` and `limit` as `number` with `@Type(() => Number)` and `@IsInt`, no `@Min`/`@Max`; clamp in the use-case, as `GetLeaderboardUseCase` does.
- [ ] **Step 3: Controller.** `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(UserRole.Admin)` at class level. Declare `stats` before `:id`. `:id` uses `ParseUUIDPipe`. Derive `suggested_action` with `suggestedAction(tier, marketingOptIn)` when mapping.
- [ ] **Step 4: Run tests, lint and build; commit.**

```json:metadata
{"files": ["src/application/leads/", "src/presentation/leads/"], "verifyCommand": "npm test -- src/application/leads", "acceptanceCriteria": ["admin only", "stats route order", "boolean filter correct", "clamping returns applied values", "action reflects current opt-in", "404 for ineligible"], "modelTier": "standard"}
```

### Task 5: End-to-end coverage

**Goal:** Pin the whole contract against real PostgreSQL.

**Files:**
- Create: `test/leads.e2e-spec.ts`

**Acceptance Criteria:**
- [ ] New user, full submit, resubmit and consent withdrawal flow passes, including the `marketing_opt_in_at` rule
- [ ] A submit with an apprentice, a due date under 3 months and Trello stores score 7, `warm`; adding a paywall signal makes it 10, `hot`, and a repeat signal leaves it at 10
- [ ] A user cannot read another user's data, and non-admins get `403` on all `/leads*` routes
- [ ] Admin and disabled accounts are absent from list and stats
- [ ] Stats arithmetic matches seeded users, with every enum key present
- [ ] Revoking an active connector lowers the score; seed the row directly, since Composio is not available in tests

**Verify:** `npm run test:e2e -- leads` → all tests pass

**Steps:**

- [ ] **Step 1: Write the spec** using `describeWithDocker`, `startPgContainer`, `startMongoMemory` and `test/utils/promote-admin.ts`. Compute due dates relative to the current date. Mirror the `ValidationPipe` options in `src/main.ts` exactly, including `enableImplicitConversion`, or the string-consent test proves nothing.
- [ ] **Step 2: Run; fix; commit.**

```json:metadata
{"files": ["test/leads.e2e-spec.ts"], "verifyCommand": "npm run test:e2e -- leads", "acceptanceCriteria": ["full flow", "score arithmetic", "authorization", "eligibility", "stats", "connector revoke lowers score"], "modelTier": "standard"}
```

### Task 6: Docs

**Goal:** Documentation matches what shipped.

**Files:**
- Modify: `docs/database-schema.md`, `docs/diagrams/database-schema.d2`, `docs/diagrams/database-schema.svg`, `docs/privacy-data-inventory.md`, `docs/integration/frontend-guide.md`, `docs/ROADMAP.md`, `docs/contracts/lead-scoring.md`

**Acceptance Criteria:**
- [ ] Schema doc lists all three tables with indexes and delete behaviour
- [ ] Privacy inventory records onboarding answers, profiling, consent record and that the "No consent record" gap is narrowed to marketing consent only
- [ ] Frontend guide links the contract and notes the first paginated envelope
- [ ] Contract status changes from draft to live, and ROADMAP shows the feature done

**Verify:** `npm run lint && npm run build` → both pass; `d2 docs/diagrams/database-schema.d2 docs/diagrams/database-schema.svg` → renders

**Steps:**

- [ ] **Step 1: Run `docs-maintainer`** with the merged diff; run it after Task 5 so the docs describe real behaviour.
- [ ] **Step 2: Commit.**

```json:metadata
{"files": ["docs/"], "verifyCommand": "npm run lint && npm run build", "acceptanceCriteria": ["schema doc updated", "privacy inventory updated", "frontend guide links contract", "contract and roadmap status updated"], "modelTier": "standard"}
```
