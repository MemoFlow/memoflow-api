# Frontend Handover — MemoFlow API

Complete, standalone guide for the frontend. Covers auth, the REST endpoints, and the
**real-time WebSocket** — the WebSocket part is written for someone who has **not** used
WebSockets before, so §6 starts from scratch.

The full machine-readable API spec ships in this folder as **`openapi.json`** — paste it
into [editor.swagger.io](https://editor.swagger.io) for interactive Swagger UI, import it
into Postman/Insomnia, or run `npx @redocly/cli preview-docs openapi.json`. The live,
always-current version is Swagger at `/docs` (`http://localhost:3000/docs` in dev); ask the
MemoFlow team for the deployed URL. This guide is the practical walkthrough; if it and the
spec ever disagree, the spec wins.

---

## 1. Setup

- **Base URL:** your environment's API origin (dev `http://localhost:3000`). Store it in one
  env value (`VITE_API_URL` / `NEXT_PUBLIC_API_URL` / …).
- **WebSocket URL:** the **same origin** as the API (it uses Socket.IO on the default
  namespace `/`).
- **Content type:** `application/json` for all request bodies.
- **Client libraries:** any HTTP client (`fetch` / `axios`) **plus** `socket.io-client`
  for the real-time feed (install it: `npm i socket.io-client`).

---

## 2. Auth (JWT)

Every endpoint except register/login needs a **Bearer token** (a JWT). Tokens are
short-lived (**15 min** by default), so handle `401` by sending the user back through
login.

### Register — `POST /auth/register` → `201`
```json
// request
{ "email": "ada@example.com", "password": "min-8-chars", "display_name": "Ada Lovelace" }
// response (never includes the password)
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
`401` on bad credentials. Send the token on **every** later call as a header:
```
Authorization: Bearer <accessToken>
```

### Current user — `GET /users/me` (needs token) → `200`
Returns the same user shape as register. `GET /users/:id` also exists.

---

## 3. Error shape (same for every error)

```json
{ "statusCode": 404, "message": "…", "error": "Not Found",
  "path": "/planning-jobs/abc", "timestamp": "2026-07-05T12:00:00.000Z" }
```
`message` is sometimes a string, sometimes a list of strings (validation errors). Drive
your UI off `statusCode`.

---

## 4. Connectors (link Trello / Notion / GitHub)

Lets a user connect an app whose content the planner can later use. The API **never holds
the user's app password/token** — a service called Composio does; you only see a
connection reference and its status.

### Start — `POST /connectors/:provider/connect` (token) → `201`
`:provider` is `trello`, `notion`, or `github` (anything else → `400`).
```json
{ "redirect_url": "https://…composio…/oauth…", "connection_id": "uuid", "status": "initiated" }
```
Open `redirect_url` (full-page redirect or popup) so the user authorizes the app. Composio
handles the return trip — **you have no callback route to build**. Afterwards, **poll**
(below) until the connection is `active`.

### List / get — `GET /connectors` (token) → `200`, `GET /connectors/:id` (token) → `200`
```json
{ "id": "uuid", "provider": "trello", "status": "initiated|active|revoked|failed",
  "connected_at": "2026-07-05T…|null", "created_at": "2026-07-05T…" }
```
These reads **self-heal**: calling `GET /connectors/:id` on an `initiated` connection
re-checks Composio, so polling it after the redirect flips it to `active`. `404` if it's
not the logged-in user's.

### Disconnect — `DELETE /connectors/:id` (token) → `204`
Revokes at Composio, marks it `revoked`.

---

## 5. Planning jobs (the async feature)

Submitting a job starts background work (gathering context + planning). You get a `job_id`
**immediately**, and the actual result arrives **later** — you watch for it over the
WebSocket (§6), with REST polling as the backup.

### Submit — `POST /planning-jobs` (token) → `202`
```json
// request — connectors is optional; only the user's ACTIVE connectors are used
{ "prompt": "Draft an outline for chapter 3", "connectors": ["trello", "notion"] }
// response
{ "job_id": "…", "status": "pending", "prompt": "…", "connectors": ["trello","notion"],
  "result": null, "error_code": null, "error_message": null,
  "created_at": "…", "started_at": null, "finished_at": null }
```
`202` means "accepted, working on it" — **not** finished. `503` if it couldn't be queued.

### Poll — `GET /planning-jobs/:id` (token) → `200`
`status` is `pending | running | completed | failed`. `result` fills in on `completed`;
`error_code` / `error_message` on `failed`. This endpoint is the **durable source of
truth** — use it whenever the socket isn't connected.

---

## 6. Real-time updates over WebSocket — from scratch

### 6.1 What a WebSocket even is
A normal REST call is one question, one answer, then the line hangs up. A **WebSocket** is
a **phone line that stays open**: after you connect once, the **server can speak to you at
any time** without you asking. That's exactly what we need — a planning job finishes
seconds or minutes later, and we want the server to *tell* you rather than you polling over
and over.

We use **Socket.IO** (a library on top of WebSockets). Instead of URLs, Socket.IO uses
**named events**: the server "emits" an event with a name (like `planning.completed`) and a
payload, and you register a handler for that name. Think of it as the server calling you and
saying "planning.completed!" and handing you the data.

### 6.2 Connecting (with auth)
Browsers can't attach an `Authorization` header to a WebSocket, so the token goes in the
**handshake** instead, as `auth.token`:

```js
import { io } from 'socket.io-client';

const socket = io(API_WS_URL, { auth: { token: accessToken } });
// API_WS_URL is the same origin as your REST base URL.
```

If the token is missing, invalid, or expired, the server **hangs up the line immediately**
— you won't get an error event, the socket just closes. Reconnect with a fresh token.

### 6.3 The events you listen for
```js
socket.on('ready', () => {
  // You're connected and authenticated. The server has automatically put you in your
  // own private "room" (based on your token) so you ONLY ever receive your own jobs.

  // Optional: after a page reload, ask for a job's current state once:
  socket.emit('subscribe', { jobId });
});

socket.on('planning.status',    (p) => { /* { jobId, status }  — pending | running */ });
socket.on('planning.completed', (p) => { /* { jobId, status, result } */ });
socket.on('planning.failed',    (p) => { /* { jobId, status, errorCode, errorMessage } */ });
socket.on('planning.error',     (p) => { /* { jobId, message } — e.g. you asked about a job that isn't yours */ });
```

What each does:

| Event | When | Payload |
| --- | --- | --- |
| `ready` | Right after a successful, authenticated connection | (none) |
| `planning.status` | Job moved to `pending` / `running` (and, later, incremental progress) | `{ jobId, status }` |
| `planning.completed` | Job finished OK | `{ jobId, status, result }` |
| `planning.failed` | Job failed | `{ jobId, status, errorCode, errorMessage }` |
| `planning.error` | You did something invalid (e.g. `subscribe` to a job that isn't yours) | `{ jobId, message }` |

### 6.4 Important behaviours
- **You only get your own jobs.** The "room" is derived from your verified token on the
  server — there's nothing for you to set, and no way to receive another user's jobs.
- **`subscribe { jobId }`** replays that job's **current** state once (handy after a
  reload), then live updates continue. It is not required to receive live updates for jobs
  you submit while connected.
- **Delivery is best-effort.** If the socket was down for a moment you might miss an
  update — that's why `GET /planning-jobs/:id` stays the source of truth. A robust UI does
  both: render from socket events, and reconcile with a REST poll on (re)connect.

---

## 7. End-to-end flow

1. `POST /auth/login` → store `accessToken`.
2. (optional) `POST /connectors/trello/connect` → open `redirect_url`; user authorizes;
   poll `GET /connectors/:id` until `status: active`.
3. Open the Socket.IO connection with `auth.token`; wait for `ready`.
4. `POST /planning-jobs { prompt, connectors: ["trello"] }` → keep `job_id`.
5. Render live off `planning.status` / `planning.completed` / `planning.failed`.
6. If the socket drops, fall back to `GET /planning-jobs/:id`.

---

## 8. Things that aren't final yet

- The planning **`result`** is a **stub echo** today. Its final shape
  (`{ suggestions, outline, sources }`) lands with the AI layer. Treat `result` as opaque
  JSON for now.
- **Document / section endpoints don't exist yet** — coming in a later roadmap item.
- When the external context engine goes live, incremental context chunks will arrive as
  extra `planning.status` events. **The event names above won't change**, so build against
  them now.
- `/docs` (Swagger) is generated from the code and always wins if this guide disagrees.

---

## 9. What to hand back to MemoFlow

Almost nothing — you're the consumer. One thing matters:

| Item | Why | Fills (MemoFlow env var) |
| --- | --- | --- |
| Your app's **deployed web origin(s)** (e.g. `https://app.memoflow.com`, plus any preview/staging origins) | So MemoFlow can lock the WebSocket/CORS allowlist to your site instead of the open `*` default | `WS_CORS_ORIGIN` |

Send it once per environment (dev / staging / prod) as those origins are known.
