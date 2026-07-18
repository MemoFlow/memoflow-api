# MemoFlow API — Frontend Integration Guide

Everything a frontend needs to talk to the MemoFlow API: auth, the REST endpoints, and
the real-time WebSocket. The live, always-current reference is **Swagger at `/docs`**
(`http://localhost:3000/docs` in dev) — this guide is the practical walkthrough.

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

### Register — `POST /auth/register` → `201`
```json
// request
{ "email": "ada@example.com", "password": "min-8-chars", "display_name": "Ada Lovelace" }
// response (UserResponseDto — never includes password)
{ "id": "uuid", "email": "ada@example.com", "display_name": "Ada Lovelace",
  "role": "user", "xp": 0, "level": 1, "last_active_at": "2026-07-05T..." }
```
`409` if the email is already registered.

### Login — `POST /auth/login` → `200`
```json
// request
{ "email": "ada@example.com", "password": "..." }
// response
{ "accessToken": "eyJhbGciOi..." }
```
`401` on bad credentials. Send the token on every subsequent call:
```
Authorization: Bearer <accessToken>
```

### Current user — `GET /users/me` (JWT) → `200` `UserResponseDto`
`GET /users/:id` (JWT) also available.

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

## 6. Planning jobs (async + real-time)

Submitting a job kicks off async context-gathering + planning; you get a `job_id`
immediately and follow progress over the WebSocket (REST polling is the fallback).

### Submit — `POST /planning-jobs` (JWT) → `202`
```json
// request — connectors is optional; only the user's ACTIVE connectors are used
{ "prompt": "Draft an outline for chapter 3", "connectors": ["trello", "notion"] }
// response (PlanningJobResponseDto)
{ "job_id": "…", "status": "pending", "prompt": "…", "connectors": ["trello","notion"],
  "result": null, "error_code": null, "error_message": null,
  "created_at": "…", "started_at": null, "finished_at": null }
```
`503` if the job couldn't be enqueued.

### Poll — `GET /planning-jobs/:id` (JWT) → `200` `PlanningJobResponseDto`
`status` ∈ `pending | running | completed | failed`. `result` is populated on
`completed`; `error_code`/`error_message` on `failed`. `404` if not yours. This is the
**durable source of truth** and the fallback when a socket isn't connected.

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

socket.on('planning.status',    (p) => {/* { jobId, status } — pending|running */});
socket.on('planning.completed', (p) => {/* { jobId, status, result } */});
socket.on('planning.failed',    (p) => {/* { jobId, status, errorCode, errorMessage } */});
socket.on('planning.error',     (p) => {/* { jobId, message } — e.g. subscribe to a job that isn't yours/doesn't exist */});
```

- **Auth failure** (missing/invalid/expired token) → the server disconnects the socket
  immediately (no event). Reconnect with a fresh token.
- **Rooms are server-derived** from the verified token — you only ever receive your own
  jobs; there's no client-supplied room to set.
- `subscribe {jobId}` replays the job's **current** state once (catch-up), then live
  `@OnEvent` relays continue. Delivery is best-effort — `GET /planning-jobs/:id` remains
  the durable fallback.
- When the context-engine transport goes live, incremental context chunks will surface as
  additional `planning.status` relays (see `docs/contracts/context-engine.md`); the event
  names above stay stable.

## 8. End-to-end example flow

1. `POST /auth/login` → store `accessToken`.
2. `POST /connectors/trello/connect` → open `redirect_url`; user authorizes.
3. Poll `GET /connectors/:id` until `status: active`.
4. Open the Socket.IO connection with `auth.token`; wait for `ready`.
5. `POST /planning-jobs` `{ prompt, connectors: ["trello"] }` → keep `job_id`.
6. Render live off `planning.status` / `planning.completed` / `planning.failed`; if the
   socket drops, fall back to `GET /planning-jobs/:id`.

## Notes & non-final surfaces

- The planning `result` payload is a **stub echo** today; its final shape
  (`{ suggestions, outline, sources }`) lands with the AI layer (roadmap item 5). Treat
  `result` as opaque JSON until then.
- Documents/sections exist (roadmap item 2, section 5 above), but `planning_jobs`
  still has no `document_id`/`section_id` bound to them — that wiring is item 5's
  remaining work.
- `/docs` (Swagger) is generated from the code and is always authoritative if this guide
  and the API ever disagree.
