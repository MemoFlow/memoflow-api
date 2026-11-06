# System Architecture

Context reference for the platform's service topology. This describes the runtime components, how they communicate, and what each one is responsible for. Use it to ground code changes in the overall design.

## High-level shape

A React single-page app sits in front of a single NestJS backend — the **Core API** — built as a modular monolith with clean/hexagonal boundaries between its domains. Everything to do with pulling in outside context and talking to the LLM lives in a dedicated, self-contained **Context module** inside that service, isolated behind its own interface so it can be extracted into a standalone service later if a concrete trigger appears (see "Service boundaries" below). The backend is fronted by a pool of shared infrastructure, with all third-party dependencies kept in an external-services layer.

```
Browser (React SPA)
      │  REST + WebSocket
      ▼
  Core API  (NestJS — modular monolith)
  ┌──────────────────────────────────────────────┐
  │  Auth · Document · Section · Search           │
  │  Gamification · Prompt · Template             │
  │  ┌────────────────────────────────────────┐  │
  │  │  Context module (bounded for extraction)│  │
  │  │  Connectors · Context assembly · LLM     │  │
  │  └────────────────────────────────────────┘  │
  └──────────────────────────────────────────────┘
      │
      ▼
  Shared infrastructure
  (PostgreSQL · MongoDB · Redis · Elasticsearch · S3)
      │
      ▼
  External services
  (LLM API · Connectors · Monitoring · CDN)
```

## Layers and components

### Client

**Browser — React SPA**
The single-page frontend. Hosts the TipTap rich-text editor (the main writing surface), the document structure planner, the dashboard, and the gamification UI. It is the only layer users interact with directly. It talks to the Core API over REST for standard request/response calls and over WebSocket for live/streamed updates (e.g. pushing incremental LLM planning results back into the editor as they are produced). It never talks to any internal module or database directly — the Core API is the single contract with the outside world.

### Core API — NestJS

The one backend service and the system's front door. It is organized as a **modular monolith**: domain-isolated modules inside a single deployment, each with its own controller → service → repository layering and no direct cross-module service imports. Modules communicate through domain events (`EventEmitter2`) rather than reaching into each other — e.g. the Document module emits a "section completed" event that the Gamification module listens for to award XP.

Modules:

- **Auth** — authentication and authorization (JWT + Passport); the trust boundary for every client request.
- **Document** — document metadata CRUD and persistence.
- **Section** — section content, ordering, status, and word counts; the granular unit most product features operate on.
- **AI** — the in-document writing features (`suggestion`, `rewrite`, `summarize`, `expand`). Provider-agnostic; wraps the LLM behind the `LlmGateway` port with versioned, admin-managed prompts, input and output guards, a daily quota, a response cache and recorded user consent.
- **Search** — user-facing full-text search, backed by Elasticsearch.
- **Gamification** — XP, levels, milestones, daily missions, and leaderboard.
- **Prompt** — versioned LLM prompt templates, queried by the AI and Context modules at call time.
- **Template** — document templates: reusable section blueprints plus a style config that informs AI output.
- **Context module** — connectors, context assembly, and LLM planning. Bounded and self-contained (see below).

### Context module

The part of the system dedicated to context gathering and connector-driven LLM planning ("help me plan this section using my Notion / GitHub / Trello data"). It lives **inside the Core API** as a module, not as a separate deployment, but it is deliberately kept self-contained so extraction is cheap later. Responsibilities:

- **Connectors** — integrations that pull data from external sources (Notion, GitHub, Trello, Gmail) behind a common `IConnector` interface, so new connectors are plug-ins.
- **OAuth vault** — provider tokens are held by Composio, not by this API; the API stores only a connection reference and status (`connector_connections`).
- **Context assembly** — truncation and relevance filtering of fetched data into a coherent, size-bounded context payload for the model.
- **LLM planning** — orchestrating the model call through the `LlmGateway` port and structuring the response (suggestions, outline, cited sources).
- **Retrieval** — before planning, a shared `PlanningPipeline` (used by both the in-process and the RabbitMQ transports) searches the job owner's own sections through the `SectionRetriever` port (Postgres full-text search over `sections.search_vector`, always scoped to the job's user), merges them with the connector context, fits them to the input budget (bound-document sections first), and renders them as numbered `[S1]` sources. After the model call, citations of sources that don't exist are removed. Only metadata about the sources is stored on the job, never their text.

The planning feature is intentionally scoped to help the user *plan and structure* a document, never to *write* it.

### Service boundaries — current and future

The Context module is bounded now so it can become a standalone service later without a rewrite. Keep the boundary in code even though it is one deployment today:

- Its work is driven asynchronously through a **BullMQ job** (enqueued via Redis), never a synchronous in-request call. A user action enqueues a planning job and returns immediately (`202`); the module processes it on a worker and the result is pushed to the browser over WebSocket when ready.
- All connector/LLM logic depends on internal ports (interfaces), not vendor SDKs directly, so the physical location of the implementation can change without touching callers.

**When to actually extract it into its own service** — do this only when a concrete trigger appears, not preemptively:

- OAuth-token isolation becomes a hard security/compliance requirement (the token-holding service must be physically separated from user/session data).
- Connector/LLM workload scales asymmetrically enough to warrant scaling it independently of the rest of the product.
- The connector layer becomes a product in its own right (white-label, third-party exposure).

At that point the extraction is a deployment change, not an architectural one — and the cross-service transport becomes relevant: it is defined as **RabbitMQ in both directions** (`ctx.gather.requests` API→Context service, `ctx.gather.results` Context service→API, correlated by `job_id`; see `docs/contracts/context-engine.md`), with the result relayed to the browser over the existing WebSocket so LLM planning output can render as it completes. gRPC was evaluated and dropped for this transport — it would require a public gRPC server on the extracted service (an inbound-streaming risk on PaaS targets like Render) where symmetric RabbitMQ needs no inbound listener on either side. Until extraction happens, none of this is needed; inside one process it is just a method call.

### Shared infrastructure

Stateful backing services used by the Core API.

| Component | Role | Notes |
|---|---|---|
| **PostgreSQL** | Primary data store / system of record | All relational, transactional, join-heavy data: users, documents, sections, AI suggestions, connector tokens, gamification, prompts, templates. Freeform-but-bounded fields (mission criteria, template style config) use `JSONB` columns. |
| **MongoDB** | Specialist store | Only two collections, both write-once/read-occasionally freeform blobs: `document_versions` (full snapshot trees, high volume) and `planning_jobs` (Context module job log with evolving per-connector shapes). |
| **Redis** | Queue + cache + counters | BullMQ job state (hard dependency); the AI daily quota counters (per user and global, UTC day, keyed by a hash of the user id) and the per-user suggestion cache (TTL `AI_CACHE_TTL_SECONDS`); the login attempt counter. Not a system of record. The quota fails closed (Redis down means AI is refused), the cache fails open (an error is a miss). Run with AOF persistence so the job queue survives a restart. |
| **Elasticsearch** | Full-text search | Indexes section content (mirrored from PostgreSQL) with an English analyzer; powers user-facing search over document content. |
| **S3** | File uploads | Object storage for user-uploaded files (PDF/DOCX) and binary assets. |

**Why PostgreSQL primary + MongoDB specialist (not one or the other):** the core data is relational and increasingly transactional (accepting a suggestion atomically updates section content, logs the suggestion, awards XP, and checks mission progress), which is PostgreSQL's strength. The two exception collections are large, append-only, and have schemas defined by external output (LLM responses, connector payloads) that would otherwise force a migration on every connector or output-format change — so they live in MongoDB. The split principle: **stable, queryable, joined/transactional data → PostgreSQL; large freeform write-once blobs → MongoDB.**

### External services

Third-party dependencies, kept behind internal abstractions so the rest of the system depends on stable internal interfaces rather than vendor specifics.

- **LLM API** — OpenRouter, which routes to upstream model providers. All LLM calls go through the domain port `LlmGateway` (`src/domain/ai/llm-gateway.port.ts`) and a single adapter (`src/infrastructure/ai/openrouter.gateway.ts`, native `fetch`), so the provider is swappable and prompts are versioned.
- **Connectors** — the external systems the Context module integrates with (Notion, GitHub, Trello, Gmail).
- **Monitoring** — observability and error tracking (Sentry for errors, Datadog for metrics/APM).
- **CDN** — delivery of static assets to the browser.

## Request lifecycles

**In-document AI suggestion** (`POST /sections/:sectionId/suggestions`), in order:

1. **Auth and gates.** JWT, then the email-verification gate, then `AiConsentGuard`: no recorded consent to the current notice version (`AI_NOTICE_VERSION`) is `403 AI_CONSENT_REQUIRED`. The guard reads the user loaded on each request, so withdrawal applies at once.
2. **Preconditions.** The section must belong to the caller (404), an active user-invocable prompt must exist for the feature type (404), the generator must be configured (503 without `OPENROUTER_API_KEY`), and the section text must fit `AI_MAX_INPUT_CHARS` (422). No provider call and no quota use so far.
3. **Input guards.** The section text and a light context (document title, previous and next section titles) are redacted best effort, look-alikes of the untrusted-data tags are neutralised, and both are rendered into the active prompt inside nonce-tagged fences. The stored section is not changed.
4. **Cache.** The key is a hash of user id, feature type, prompt version, model scope and the prepared input. A hit is re-validated and returns without a provider call or quota use; it still creates a new `ai_suggestions` row. A cache error is a miss.
5. **Quota and gateway.** On a miss the call goes through `OpenRouterGateway`, which reserves one unit from the user and global daily counters before every provider attempt, retries included. Over a cap: `429` with `Retry-After`. Counters unreachable: `503`. The gateway sends a `json_schema` response format, retries conservatively within one deadline, and allows one repair retry for unparsable JSON.
6. **Output guards.** The reply is parsed into a typed shape and rejected (`502`) if empty, oversized, or if it echoes the system prompt or the input. Only validated output is cached.
7. **Persist.** An `ai_suggestions` row is written (original text, suggested text, prompt version, model) and returned for inline accept or reject (`PATCH /suggestions/:id`).

**Connector-driven planning** (`POST /planning-jobs`), in order:

1. **Submit.** Auth, verification and consent gates as above, then the prompt (max 5000 characters), ownership of any bound `documentId`/`sectionId`, and `connectors` (the caller's active providers) are validated. With a real provider the daily quota is checked, not spent (`429`/`503`), so a user already over a cap hears it now. A `pending` job is written to `planning_jobs` in MongoDB and enqueued on BullMQ; the response is `202` with `job_id`.
2. **Worker start.** The worker claims the job and re-checks the user: disabled or deleted fails the job `USER_INACTIVE`, withdrawn or stale consent fails it `AI_CONSENT_REQUIRED`. Both checks run before anything leaves the API.
3. **Gather.** Connector context comes from the context engine over RabbitMQ (`gathering`, chunks relayed live over WebSocket) when `RABBITMQ_URL` is set, otherwise from the synchronous HTTP client or the stub (`running`).
4. **Retrieve.** The shared `PlanningPipeline` searches the job owner's own sections (Postgres full-text search, always scoped to the job's user; at most 8, bound document first), merges the connector context, applies the input budget, and renders numbered `[S1]` sources, each redacted before it is cut to 4000 characters. A retrieval error is logged by name only and the job continues without it. Consent and user status are checked again right before the model call.
5. **Plan.** The planner calls the gateway, which reserves quota before each attempt (`AI_QUOTA_EXCEEDED` or `AI_QUOTA_UNAVAILABLE` fail the job). The same input and output guards apply; a reply that echoes the prompt fails the job.
6. **Validate and store.** Citations of sources that don't exist are removed. The job is stored `completed` (or `failed` with a fixed `error_code`/`error_message`) in MongoDB with `context_used.retrieval` holding metadata only, never retrieved text, and the result is pushed to the browser over WebSocket (`GET /planning-jobs/:id` is the durable fallback).

Where this flow is not yet proven: it is covered by unit and e2e tests with a fake provider, and `npm run ai:smoke` is the owner-run live check (see `docs/ROADMAP.md`).

## Design principles worth keeping in mind

- **Modular monolith, clean boundaries.** One deployable Core API, domain-isolated modules, no direct cross-module service imports — communicate via domain events. This keeps the option of extracting a module (notably Context) into its own service cheap, without paying the distributed-systems tax before there is a reason to.
- **Async for slow work.** Connector/LLM planning goes through BullMQ, never a synchronous in-request path, so latency-sensitive product calls stay responsive under LLM latency.
- **PostgreSQL is the source of truth.** MongoDB holds only freeform specialist blobs; Redis only accelerates. Losing Redis is an inconvenience; losing PostgreSQL is a crisis. Cross-store references use the same UUIDs as PostgreSQL primary keys, so no ID-translation layer is needed.
- **External dependencies are isolated.** LLM providers, connectors, and monitoring sit behind internal ports/adapters; internal code depends on internal abstractions, not vendor SDKs directly.
- **Streaming stays a Core-API concern at the edge.** The browser always streams from the Core API over WebSocket. If/when the Context module becomes a separate service, it returns results to the Core API over the `ctx.gather.results` RabbitMQ queue (contract: `docs/contracts/context-engine.md`), which the Core API relays over WebSocket — the frontend never learns there is a second service.
- **AI plans, it does not write.** The product deliberately assists structure and clarity; it never generates the user's ideas or drafts their content.
