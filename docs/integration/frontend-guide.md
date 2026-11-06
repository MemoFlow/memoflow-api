# MemoFlow API — Frontend Integration Guide

Everything a frontend needs to talk to the MemoFlow API: auth, the REST endpoints, and
the real-time WebSocket. The live, always-current reference is **Swagger at `/docs`**
(`http://localhost:3000/docs` in dev; Swagger is not served on staging or production) — this guide is the practical walkthrough.

## 1. Setup

- **Base URL:** your environment's API origin (dev `http://localhost:3000`). Put it in a
  single config/env value (`VITE_API_URL` / `NEXT_PUBLIC_API_URL` / …).
- **WebSocket URL:** same origin (Socket.IO, default namespace `/`).
- **Content type:** `application/json` for all request bodies.
- **Client deps:** any HTTP client (`fetch`/`axios`) + **`socket.io-client`** for the
  real-time feed.

## 2. Auth (JWT)

All non-auth endpoints require a **Bearer JWT**. Tokens are short-lived
(default **15 min** — `JWT_EXPIRES_IN`); plan for re-login/refresh on `401`.

### Register — `POST /auth/register` → `202`
```json
// request
{ "email": "ada@example.com", "password": "min-8-chars", "display_name": "Ada Lovelace" }
```
Always answers `202` with the same `{ "message": "..." }` body, whether or not the address
already has an account, so don't expect a user object or a `409`. Send the user to a "check
your email" screen. They log in separately once they can.

### Login — `POST /auth/login` → `200`
```json
// request
{ "email": "ada@example.com", "password": "..." }
// response
{ "accessToken": "eyJhbGciOi..." }
```
`401` on bad credentials. `429` after 10 attempts for the same email within 15 minutes;
read the `Retry-After` header (seconds) and disable the form until then. A successful
login or password reset resets the count. The password length limit below isn't checked on login.

Send the token on every subsequent call:
```
Authorization: Bearer <accessToken>
```

### Logout — `POST /auth/logout` (JWT) -> `204`
Ends **all** of the user's sessions, on every device, not just this one: every token
issued so far stops working and open WebSocket connections are closed. Discard the
stored token and send the user to the login screen.

### Password length
`register`, `reset-password` and `change-password` return `400` when the password is
over **72 bytes**. It's a byte count, so non-ASCII characters count for 2 to 4 each; a
length counter in characters will under-report. Show the server's message.

### Current user — `GET /users/me` (JWT) → `200` `UserResponseDto`
`GET /users/:id` (JWT) is available for your own id or, for admins, any id; otherwise `404`.
`disabled_at` is only present for admin viewers. A disabled account cannot log in, its existing tokens are rejected (`401`), and its open WebSocket connections are dropped.

`email_verified` (boolean) is on every `UserResponseDto`. Use it to show a "verify your email" banner with a resend button.

### Email flows (forgot / reset / verify)
Emails link to your frontend, built from the server's `APP_BASE_URL`:
`<APP_BASE_URL>/reset-password#token=...` and `<APP_BASE_URL>/verify-email#token=...`.
The token is in the URL **fragment**, so read it from `location.hash` (it never
reaches server logs) and POST it in the JSON body. Clear the fragment afterwards.
Three pages are needed:

| page | action |
| --- | --- |
| `/forgot-password` | form with an email; `POST /auth/forgot-password` `{ "email" }` -> always `202`, so show a neutral "if the address has an account, we sent an email" message |
| `/reset-password` | read `token` from the fragment; form with a new password (min 8); `POST /auth/reset-password` `{ "token", "new_password" }` -> `204`, then send the user to login. `400` = invalid, used or expired link (reset links last 1 hour) |
| `/verify-email` | read `token` from the fragment; `POST /auth/verify-email` `{ "token" }` -> `204`. `400` = invalid, used or expired link (24 hours); offer a resend |

Resend a verification email with `POST /auth/resend-verification` (JWT) -> always
`202`; nothing is sent if the account is already verified or an email went out in
the last 5 minutes. Tokens are single-use.

### Change password — `POST /auth/change-password` (JWT) -> `200`
```json
// request
{ "current_password": "...", "new_password": "min-8-chars" }
// response
{ "accessToken": "eyJhbGciOi..." }
```
`400` if the current password is wrong. All previous tokens stop working, so replace
the stored token with the new one. Open WebSocket connections are dropped: call
`io(...)` again with the new token. A completed password reset also invalidates
existing sessions.

### Email verification gate (`403 Email not verified`)
When the server runs with `EMAIL_VERIFICATION_REQUIRED=true` (always the case in
staging and production), unverified accounts get `403` with message
`Email not verified` on AI suggestion routes (`/sections/:sectionId/suggestions`,
`/suggestions/*`), `/connectors*` and `/planning-jobs*`. Other routes still work.
Handle it by prompting the user to verify (and offering resend) rather than treating
it as a permission error. Check `email_verified` from `GET /users/me` up front to
avoid the round trip.

### Admin-only user management
`POST /users/:id/disable` and `POST /users/:id/enable` (JWT, admin role) → `204`. Non-admins get `403`; disabling your own account is `400`.

### Templates — role rules
- Only admins can publish templates (`is_published: true`); other callers get `403`.
- Non-admins cannot edit a published template (`403`), including when a publish lands while their edit is in flight.
- `POST /templates/:id/apply` returns `400` when the template's `doc_type` differs from the document's; offer only templates matching the document's type.
- `created_by` in template responses is `null` unless the viewer owns the template or is an admin.

### Templates — section `key_points` and `guidance`
- Template sections carry optional `key_points` (string array or `null`) and `guidance` (string or `null`) in responses; send them as `keyPoints` and `guidance` in request bodies (`keyPoints`: max 50 items of 2000 chars; `guidance`: max 5000 chars).
- They are guidance to show while the user writes. `POST /templates/:id/apply` does **not** copy them into the document's sections; read them from the template.
- `PATCH` with `sections` replaces all sections wholesale, so section ids change, and any omitted `keyPoints`/`guidance` become `null`.

### Leaderboard — `GET /gamification/leaderboard` (JWT)
**Breaking change:** entries no longer include `user_id`. Each entry has `is_me` (boolean) to identify the caller's own row; do not rely on user ids to match rows.

## 3. Uniform error envelope

Every error response has this shape (from the global exception filter):
```json
{ "statusCode": 404, "message": "…", "error": "Not Found",
  "path": "/planning-jobs/abc", "timestamp": "2026-07-05T12:00:00.000Z" }
```
`message` may be a string or a string[] (validation errors). Key the UI off `statusCode`.

## 4. Connectors (OAuth via Composio)

Lets a user connect a provider (Trello / Notion / GitHub) whose context the planner can
use. **This API never holds provider tokens** — Composio is the vault; here you only see a
connection reference + status.

### Start a connection — `POST /connectors/:provider/connect` (JWT) → `201`
`:provider` ∈ `trello | notion | github` (unknown → `400`).
```json
// response
{ "redirect_url": "https://…composio…/oauth…", "connection_id": "uuid", "status": "initiated" }
```
**Flow:** open `redirect_url` (full-page redirect or popup) so the user authorizes on the
provider. Composio handles the OAuth callback; you don't. Then **poll** the connection
until it's active (below). The browser journey after authorization is owned by
Composio/your product — no callback route on this API.

### List / get — `GET /connectors` (JWT) → `200` `ConnectorResponseDto[]`, `GET /connectors/:id` (JWT) → `200`
```json
// ConnectorResponseDto (no token, no account id — safe to render)
{ "id": "uuid", "provider": "trello", "status": "initiated|active|revoked|failed",
  "connected_at": "2026-07-05T…|null", "created_at": "2026-07-05T…" }
```
Reads **self-heal**: a `GET` on an `initiated` connection re-checks Composio, so polling
`GET /connectors/:id` after the redirect will flip it to `active`. `404` if not yours.

### Disconnect — `DELETE /connectors/:id` (JWT) → `204`
Revokes at Composio and marks the connection `revoked`. `404` if not yours.

## 5. Documents + sections

A document is a container; sections are its ordered content blocks. All routes are
JWT-guarded and **owner-scoped** — a document/section that doesn't exist, or belongs
to another user, both 404 the same way (no existence leak). JSON is **snake_case** on
responses; request bodies (except the reorder endpoint's `sectionIds`) are
**camelCase** to match the DTOs below — check Swagger if in doubt.

### Documents

`POST /documents` (JWT) → `201`
```json
// request
{ "title": "Q3 Planning Doc", "docType": "planning", "status": "draft", "styleConfig": {} }
// response (DocumentResponseDto)
{ "id": "uuid", "user_id": "uuid", "title": "Q3 Planning Doc", "doc_type": "planning",
  "status": "draft", "style_config": {}, "created_at": "…", "updated_at": "…" }
```
`docType` is required; `status` (default `draft`) and `styleConfig` (default `{}`) are optional.

- `GET /documents` (JWT) → `200` `DocumentResponseDto[]` — the caller's documents.
- `GET /documents/:id` (JWT) → `200` `DocumentResponseDto`, `404` if not yours.
- `PATCH /documents/:id` (JWT) → `200` `DocumentResponseDto` — partial update, same
  fields as create (all optional). `404` if not yours.
- `DELETE /documents/:id` (JWT) → `204` — cascades to its sections. `404` if not yours.

### Sections

Nested under a document: `/documents/:documentId/sections`. `:documentId` must be a
document you own, or every route below 404s.

`POST /documents/:documentId/sections` (JWT) → `201`
```json
// request — no `order`: a new section is always appended
{ "title": "Introduction", "content": "Lorem ipsum dolor sit amet.", "status": "draft" }
// response (SectionResponseDto)
{ "id": "uuid", "document_id": "uuid", "title": "Introduction",
  "content": "Lorem ipsum dolor sit amet.", "order": 0, "status": "draft",
  "word_count": 6, "created_at": "…", "updated_at": "…" }
```
`word_count` is always server-computed from `content` — never send it, and it's
recomputed automatically on any `PATCH` that changes `content`.

- `GET /documents/:documentId/sections` (JWT) → `200` `SectionResponseDto[]`, ordered
  by `order` ascending.
- `GET /documents/:documentId/sections/:id` (JWT) → `200` `SectionResponseDto`, `404`
  if not yours.
- `PATCH /documents/:documentId/sections/:id` (JWT) → `200` `SectionResponseDto` —
  partial update of `title`/`content`/`status` only; **`order` cannot be set here**,
  `400`-level validation simply ignores it if sent (use reorder below instead).
  `404` if not yours.
- `DELETE /documents/:documentId/sections/:id` (JWT) → `204`. `404` if not yours.

### Reordering sections — `PATCH /documents/:documentId/sections/reorder` (JWT) → `200`
```json
// request — sectionIds: the FULL set of this document's section ids, in the new order
{ "sectionIds": ["uuid-3", "uuid-1", "uuid-2"] }
// response
[ /* SectionResponseDto[], re-fetched in the new order */ ]
```
`400` if `sectionIds` isn't exactly the document's current set of section ids (missing
one, extra one, or a duplicate all reject). This is the **only** way a section's
`order` changes — it's never settable via create or update.

### AI suggestions — `POST /sections/:sectionId/suggestions` (JWT, verified email) → `201`
```json
// request
{ "featureType": "rewrite" }
```
`featureType` is one of `suggestion`, `rewrite`, `summarize`, `expand`. Any other value
(including `planning`, which is internal) returns `404`, the same as a section that isn't
yours. `422` if the section text is too long for AI processing (limit set by the server). `502` if the model's reply was unusable or the provider failed. `503` if AI is unavailable right now (this includes the usage limits being unavailable). `429` when the daily AI limit is spent: each user gets a daily number of attempts and the whole service has a shared one, counted together with planning jobs and reset at UTC midnight; the `Retry-After` header gives the seconds until then, so show a "try again later" message and disable the button until it passes. A repeated identical request (same section text and feature) can return quickly from a cache as a **new** suggestion row, so do not assume each `201` took a model call. The response (`SuggestionResponseDto`) includes
`prompt_version` and `model` (the model that served the call; `null` on suggestions
created before models were recorded). `GET /sections/:sectionId/suggestions` lists them
newest first, with the same fields.

Secrets in section text are replaced before the text reaches the model, so `suggested_text`
can contain a literal `[REDACTED]`. The stored section isn't changed, but warn the user before
applying such a suggestion, because applying it as is would put the placeholder in the document.

## 6. Planning jobs (async + real-time)

Submitting a job kicks off async context-gathering + planning; you get a `job_id`
immediately and follow progress over the WebSocket (REST polling is the fallback).

### Submit — `POST /planning-jobs` (JWT) → `202`
```json
// request — connectors is optional; only the user's ACTIVE connectors are used
{ "prompt": "Draft an outline for chapter 3", "connectors": ["trello", "notion"] }
// response (PlanningJobResponseDto)
{ "job_id": "…", "status": "pending", "prompt": "…", "connectors": ["trello","notion"],
  "model": null, "result": null, "error_code": null, "error_message": null,
  "created_at": "…", "started_at": null, "finished_at": null }
```
`400` if `prompt` is longer than 5000 characters, or if `connectors` is not a list of at most 10 unique provider names (up to 64 characters each) that are all your **active** connections. `429` with `Retry-After` (seconds until UTC midnight) when the daily AI limit is spent; it is the same limit as suggestions, shared per user and across the service. `503` if the job couldn't be enqueued or the AI usage limits are unavailable.

A job can also fail later with `error_code` `USER_INACTIVE` (the account was disabled before the job ran), `AI_QUOTA_EXCEEDED` (the daily limit was spent by the time it ran) or `AI_QUOTA_UNAVAILABLE` (limits could not be checked). Show the fixed `error_message`; for `AI_QUOTA_EXCEEDED` offer a retry the next day.

### Poll — `GET /planning-jobs/:id` (JWT) → `200` `PlanningJobResponseDto`
`model` is `null` until the job has run, and when no model is known.

`status` ∈ `pending | running | gathering | planning | completed | failed`. `running`
is the legacy synchronous context-gather path; `gathering`/`planning` only appear
when the environment has the async RabbitMQ transport enabled (live on
`development` as of 2026-07-20 — see
[`../contracts/context-engine.md`](../contracts/context-engine.md)). `result` is
populated on `completed`; `error_code`/`error_message` on `failed`; `error_message` is a fixed, generic message, so show it as-is and don't parse it. `error_code` doesn't name the specific connector or cause. Treat `result` and suggestion text as untrusted model output and let users review it before applying. `404` if not
yours. This is the **durable source of truth** and the fallback when a socket isn't
connected.

### Result shape and citations
Planning draws on the user's own sections (and connector context) as numbered sources.
On `completed`:
```json
{ "suggestions": ["Open with the budget risk [S1]"], "outline": "1. Scope [S1, S2]\n2. ...",
  "sources": [ { "id": "S1", "type": "section", "title": "Budget (Q3 plan)" },
               { "id": "S2", "type": "connector", "title": "trello" } ] }
```
- `[S1]` markers in `suggestions` and a string `outline` point at entries of `sources`
  by `id`. `type` is `section` (the user's own section, titled `section (document)`) or
  `connector`. `sources` carries no source text, and ids that don't exist are removed
  from both the list and the inline markers, so every marker you see resolves.
  `outline` may be a non-string value, which is returned as is.
- Source ids are per job (`S1` is not stable across jobs).
- `context_used` (on `GET /planning-jobs/:id`) has a `retrieval` key beside any
  connector context: `{ sources: [{ id, type, title, ref, truncated }], matched, used,
  dropped, truncated, failed }`. It is metadata only. `ref` is the section id (use it to
  link to the section) or the provider; `truncated` means the excerpt sent to the model
  was cut; `dropped` counts sources left out for size; `failed: true` means retrieval
  errored and the plan ran without the user's sections.
- Retrieval only ever uses the job owner's sections. A job bound to a `documentId` /
  `sectionId` always includes that document's sections; other documents are included
  only when they match the prompt's words. Matching is by exact word (any language, no
  stemming), so `plan` does not match `planning`.

## 7. Real-time WebSocket (Socket.IO)

Push updates for planning jobs. Default namespace `/`; the JWT travels in the handshake
`auth.token` (browsers can't set WS headers).

```js
import { io } from 'socket.io-client';

const socket = io(API_WS_URL, { auth: { token: accessToken } });

socket.on('ready', () => {
  // authenticated; you're auto-joined to your own user room (server-derived).
  // Optional catch-up for a specific job (e.g. after a reload):
  socket.emit('subscribe', { jobId });
});

socket.on('planning.status',    (p) => {/* { jobId, status } — pending|running|gathering|planning */});
socket.on('planning.chunk',     (p) => {/* { jobId, sequence, type: 'data'|'status', data?, status? } — RabbitMQ transport only, one per non-terminal ctx.gather.results chunk */});
socket.on('planning.completed', (p) => {/* { jobId, status, result } */});
socket.on('planning.failed',    (p) => {/* { jobId, status, errorCode, errorMessage } */});
socket.on('planning.error',     (p) => {/* { jobId, message } — e.g. subscribe to a job that isn't yours/doesn't exist */});
```

- **Auth failure** (missing/invalid/expired token) → the server disconnects the socket
  immediately (no event). Reconnect with a fresh token.
- **Sockets end when the token does.** The server disconnects a socket at its JWT's expiry
  (default 15 min), also with no event. On `disconnect`, get a fresh token (log in again if
  yours expired) and call `io(...)` again; then `subscribe` to any job you're following.
  Logout and password changes also drop the socket.
- **Rooms are server-derived** from the verified token — you only ever receive your own
  jobs; there's no client-supplied room to set.
- `subscribe {jobId}` replays the job's **current** state once (catch-up), then live
  `@OnEvent` relays continue. Delivery is best-effort — `GET /planning-jobs/:id` remains
  the durable fallback.
- **`planning.chunk` is live on `development`** (verified end-to-end 2026-07-20): once
  the async RabbitMQ context-engine transport is enabled for an environment
  (`RABBITMQ_URL` set — see [`../contracts/context-engine.md`](../contracts/context-engine.md)),
  each gathered context chunk relays as a `planning.chunk` event as it arrives, in
  addition to `planning.status` moving through `gathering` → `planning`. On
  environments without the transport enabled, only `planning.status`
  (`pending`/`running`) and the two terminal events fire — `planning.chunk` never
  arrives there.

## 8. End-to-end example flow

1. `POST /auth/login` → store `accessToken`.
2. `POST /connectors/trello/connect` → open `redirect_url`; user authorizes.
3. Poll `GET /connectors/:id` until `status: active`.
4. Open the Socket.IO connection with `auth.token`; wait for `ready`.
5. `POST /planning-jobs` `{ prompt, connectors: ["trello"] }` → keep `job_id`.
6. Render live off `planning.status` / `planning.chunk` (RabbitMQ-transport
   environments only) / `planning.completed` / `planning.failed`; if the socket
   drops, fall back to `GET /planning-jobs/:id`.

## 9. Onboarding and lead scoring

The "Personnalise ton espace" answers, marketing consent, paywall signals and the admin
lead views are specified in [`../contracts/lead-scoring.md`](../contracts/lead-scoring.md)
(merged to `development`, not yet on staging or production, shapes frozen, additive changes only). Routes:
`GET/PUT /onboarding/me`, `PUT /onboarding/me/consent`, `POST /lead-signals`, and admin
`GET /leads`, `GET /leads/stats`, `GET /leads/:id`. Score and tier appear only on admin
routes; never show a user their own score.

Two things differ from the rest of the API:

- `GET /leads` returns the **first paginated envelope** in the API:
  `{ items, total, page, limit }`. Other list routes return bare arrays.
- **JSON request bodies on these routes are snake_case** (`due_date`, `marketing_opt_in`),
  unlike the documents routes, whose bodies are camelCase.

## Notes & non-final surfaces

- With `OPENROUTER_API_KEY` unset the planner is a **stub echo** (`sources` is `[]`);
  see section 6 for the real `result` shape.
- Documents/sections exist (roadmap item 2, section 5 above), but `planning_jobs`
  still has no `document_id`/`section_id` bound to them — that wiring is item 5's
  remaining work.
- `/docs` (Swagger) is generated from the code and is always authoritative if this guide
  and the API ever disagree.
