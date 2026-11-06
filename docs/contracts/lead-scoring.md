# Onboarding and Lead Scoring API Contract

> **Status: merged to `development` (PR #67), not yet promoted to staging or production.**
> Routes are live only in environments that have this code. The shapes are frozen: additive
> changes only, and any breaking change is announced first.
> **Audience:** the MemoFlow frontend team.

The frontend collects the "Personnalise ton espace" answers (8 questions) and submits them
in one call. The API converts them to points, stores the score, and suggests an action for
each lead on admin routes.

**Score visibility:** score, tier, breakdown and suggested action appear only on admin
routes. User routes never return them, so do not build UI that shows a user their own score.

## Conventions

- Every route needs `Authorization: Bearer <accessToken>`; a missing or invalid token, or a
  disabled account, gets `401`.
- JSON fields are `snake_case`, in request bodies too (unlike the documents routes). Dates are `YYYY-MM-DD`. Timestamps are ISO 8601.
- Errors use the standard envelope `{ statusCode, message, error, path, timestamp }`.
  `message` may be a `string` or a `string[]`, so key the UI off `statusCode`.
- Unknown body fields are silently stripped, not rejected.

## Enums

```ts
// apprentice = alternant, intern = stagiaire, student = étudiant sans alternance, other = autre
type Persona = 'apprentice' | 'intern' | 'student' | 'other';
type DeliverableType = 'thesis' | 'apprenticeship_report' | 'internship_report' | 'other';
type AcademicLevel = 'l3' | 'm1' | 'm2' | 'other';
type WorkTool = 'trello' | 'notion' | 'teams' | 'slack' | 'email' | 'drive' | 'other';
type Blocker = 'getting_started' | 'finding_past_work' | 'structuring' | 'writing' | 'lack_of_time';
type AcquisitionChannel = 'friend' | 'school' | 'tiktok' | 'instagram' | 'linkedin' | 'google' | 'other';
type LeadSignalType = 'export_paywall_hit';
type LeadTier = 'hot' | 'warm' | 'cold';
type ConnectorProvider = 'trello' | 'notion' | 'github'; // what can be connected, unlike WorkTool
type SuggestedAction = 'interview_and_pro_offer' | 'scheduled_emails' | 'newsletter' | 'no_outreach';
type ScoreRule =
  | 'due_within_3_months' | 'due_within_3_to_6_months'
  | 'persona_apprentice' | 'persona_intern'
  | 'cited_trello' | 'connected_tool' | 'export_paywall_hit';
```

## User routes

```ts
interface OnboardingAnswers {
  persona: Persona;                          // Q1 "Tu es..."
  deliverable_type: DeliverableType;         // Q2 "Tu dois rendre quoi ?"
  due_date: string;                          // Q3 "C'est pour quand ?"
  academic_level: AcademicLevel;             // Q4 "Ton niveau"
  school_name?: string | null;               // Q5 "Ton école", optional
  work_tools: WorkTool[];                    // Q6 traces du travail; [] = none of these
  blockers: Blocker[];                       // Q7 "Qu'est-ce qui te bloque ?"
  acquisition_channel: AcquisitionChannel;   // Q8 "Comment nous as-tu connus ?"
  marketing_opt_in: boolean;                 // consent checkbox, unticked by default
}

// Before the first submit, `completed` and `marketing_opt_in` are false and every other
// field is null, including `work_tools` and `blockers`.
interface OnboardingResponse {
  completed: boolean;
  persona: Persona | null;
  deliverable_type: DeliverableType | null;
  due_date: string | null;
  academic_level: AcademicLevel | null;
  school_name: string | null;
  work_tools: WorkTool[] | null;
  blockers: Blocker[] | null;
  acquisition_channel: AcquisitionChannel | null;
  marketing_opt_in: boolean;
  marketing_opt_in_at: string | null;        // see below
  submitted_at: string | null;               // latest submit
}
```

`marketing_opt_in_at` is set on the first submit, whatever the value, and again only when
the value actually changes. Resending the same value leaves it untouched.

School autocomplete is frontend-owned: use your own school list and send the chosen name
as `school_name`. The API has no schools route.

Keep answers in frontend state between screens. Nothing is saved until the submit.

### `GET /onboarding/me` → `200 OnboardingResponse`

Never `404`. Use `completed` to decide whether to show the flow.

### `PUT /onboarding/me` → `200 OnboardingResponse`

Submits all answers. A later call replaces them entirely, so send the full body again to
edit answers. Every field is required except `school_name`.

| field | rule |
| --- | --- |
| `persona`, `deliverable_type`, `academic_level`, `acquisition_channel` | enum value |
| `due_date` | real calendar date, `YYYY-MM-DD`; if it differs from the stored value, not before yesterday (UTC), which allows for time zones. The UI should block past dates using the user's local date |
| `school_name` | string of at most 120 characters, trimmed; omit, `null` or blank all store `null` |
| `work_tools` | array of unique enum values; `[]` is a valid answer, but the field is required |
| `blockers` | array of unique enum values; at least 1 |
| `marketing_opt_in` | boolean, always explicit so a resubmit cannot change consent by accident |

Invalid or missing values get `400`.

```jsonc
// request
{ "persona": "apprentice", "deliverable_type": "apprenticeship_report",
  "due_date": "2027-01-15", "academic_level": "m2", "school_name": "ESGI",
  "work_tools": ["trello", "email"], "blockers": ["finding_past_work", "lack_of_time"],
  "acquisition_channel": "friend", "marketing_opt_in": true }
// 200: the same fields, plus
{ "completed": true, "marketing_opt_in_at": "2026-11-06T12:00:00.000Z",
  "submitted_at": "2026-11-06T12:00:00.000Z" }
```

### `PUT /onboarding/me/consent` → `200 OnboardingResponse`

```json
{ "marketing_opt_in": false }
```

Changes only the consent choice, so a user can withdraw it at any time without resending
answers. `marketing_opt_in` is required. Before the first submit this gets `409`; consent
is then part of `PUT /onboarding/me`. Does not change the score.

### `POST /lead-signals` → `204`

```json
{ "type": "export_paywall_hit" }
```

Send when the Pro paywall is shown after a user clicks export. Returns no body. Safe to
repeat; it scores once. An unknown `type` gets `400`. Calls from admin accounts return
`204` and are ignored.

## Admin routes

These need the `admin` role; other users get `403`. Admin and disabled accounts are not
leads. Users who have not submitted onboarding are leads too: they can still earn points
from behaviour, and until something scores them they show `score: 0`, `tier: "cold"` and
`score_computed_at: null`.

```ts
interface LeadSummary {
  user_id: string;
  email: string;
  display_name: string;
  score: number;
  tier: LeadTier;
  suggested_action: SuggestedAction;
  score_computed_at: string | null;
  onboarding_completed: boolean;
  persona: Persona | null;
  due_date: string | null;
  marketing_opt_in: boolean;
  registered_at: string;                   // account creation
  last_active_at: string | null;
}

interface LeadDetail extends LeadSummary {
  breakdown: { rule: ScoreRule; points: number }[]; // only rules that fired
  onboarding: OnboardingResponse;
  active_connectors: ConnectorProvider[];           // e.g. ["trello"]
  signals: {
    type: LeadSignalType;
    first_seen_at: string;
    last_seen_at: string;
    occurrences: number;
  }[];
}
```

### `GET /leads` → `200 { items: LeadSummary[], total, page, limit }`

| query | rule |
| --- | --- |
| `tier` | optional `LeadTier` |
| `onboarding_completed`, `marketing_opt_in` | optional; exactly `true` or `false`, anything else gets `400` |
| `page` | integer, default `1`; below 1 is clamped to 1, above 1,000,000,000 is clamped to 1,000,000,000, a non-integer gets `400` |
| `limit` | integer, default `25`; outside 1..100 is clamped, a non-integer gets `400` |

The response returns the `page` and `limit` actually applied. A page past the end returns
`200` with empty `items`. Sorted by stored score descending, then soonest `due_date` that
has not passed, with past and null dates last, then `user_id` ascending, so pages stay
stable. The `tier` filter also uses the stored value.

Backend note: `main.ts` enables implicit conversion, which turns the string `"false"` into
`true`. The boolean filters need an explicit transform, not a plain `@IsBoolean`.

### `GET /leads/stats` → `200`

Backend note: register this static route before `GET /leads/:id`, or `stats` is parsed as
an id and gets `400`.

Every enum key is always present, zero-filled. All counts are users, not occurrences.
Distributions count submitted answers only, and multi-select fields (`work_tools`,
`blockers`) can sum above `total_leads`.

```jsonc
{
  "generated_at": "2026-11-06T12:00:00.000Z",
  "total_leads": 120,
  "tiers": { "hot": 8, "warm": 41, "cold": 71 },
  "suggested_actions": { "interview_and_pro_offer": 6, "scheduled_emails": 28, "newsletter": 20, "no_outreach": 66 },
  "onboarding": { "not_started": 45, "completed": 75 },
  "marketing_opt_in": 54,
  "connected_tool": 22,
  "signals": { "export_paywall_hit": 11 },
  "distributions": {
    "persona": { "apprentice": 35, "intern": 20, "student": 15, "other": 5 },
    "deliverable_type": { "thesis": 30, "apprenticeship_report": 25, "internship_report": 15, "other": 5 },
    "academic_level": { "l3": 15, "m1": 20, "m2": 35, "other": 5 },
    "work_tools": { "trello": 18, "notion": 30, "teams": 40, "slack": 12, "email": 55, "drive": 48, "other": 6 },
    "blockers": { "getting_started": 30, "finding_past_work": 42, "structuring": 25, "writing": 20, "lack_of_time": 38 },
    "acquisition_channel": { "friend": 28, "school": 12, "tiktok": 12, "instagram": 7, "linkedin": 4, "google": 10, "other": 2 }
  }
}
```

### `GET /leads/:id` → `200 LeadDetail`

`404` if the user is unknown, an admin or disabled. `400` if `id` is not a uuid.

## Scoring rules

For information only: the frontend never computes a score. Weights and thresholds are
expected to be tuned and are **not** part of this contract; the response shapes are.

The score is stored and recalculated when answers are submitted, when a paywall signal is
recorded, and when a connector becomes active or stops being active. It is not recalculated
as time passes, so due-date points reflect `score_computed_at`, not today.

| rule | condition | points |
| --- | --- | --- |
| `due_within_3_months` | today ≤ `due_date` < today + 3 calendar months | 3 |
| `due_within_3_to_6_months` | today + 3 months ≤ `due_date` ≤ today + 6 months | 2 |
| `persona_apprentice` | `persona` is `apprentice` | 2 |
| `persona_intern` | `persona` is `intern` | 1 |
| `cited_trello` | `work_tools` contains `trello` | 2 |
| `connected_tool` | at least one connector has status `active`; scores once, not per tool | 3 |
| `export_paywall_hit` | signal received at least once | 3 |

A past due date, or one more than 6 months away, scores 0. "Today" is the UTC date at
calculation. Adding months past the end of a shorter month lands on its last day
(30 Nov + 3 months = 28 Feb).

Onboarding answers alone cap at 7, so reaching `hot` takes a connected tool or a paywall hit.

## Tiers and suggested actions

| tier | score | `suggested_action` with opt-in | meaning |
| --- | --- | --- | --- |
| `hot` | 8 or more | `interview_and_pro_offer` | Priority for a direct interview and the Pro offer |
| `warm` | 4 to 7 | `scheduled_emails` | Scheduled emails adapted to the due date |
| `cold` | under 4 | `newsletter` | Methodology tips newsletter |

Any lead with `marketing_opt_in: false` gets `no_outreach`, whatever the tier. The action
is a suggestion for admins: the API sends no email.
