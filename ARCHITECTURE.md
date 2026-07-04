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
- **AI** — the in-document writing features (rephrase, tone check, structure check). Provider-agnostic; wraps the LLM behind an interface with versioned prompts.
- **Search** — user-facing full-text search, backed by Elasticsearch.
- **Gamification** — XP, levels, milestones, daily missions, and leaderboard.
- **Prompt** — versioned LLM prompt templates, queried by the AI and Context modules at call time.
- **Template** — document templates: reusable section blueprints plus a style config that informs AI output.
- **Context module** — connectors, context assembly, and LLM planning. Bounded and self-contained (see below).

### Context module

The part of the system dedicated to context gathering and connector-driven LLM planning ("help me plan this section using my Notion / GitHub / Trello data"). It lives **inside the Core API** as a module, not as a separate deployment, but it is deliberately kept self-contained so extraction is cheap later. Responsibilities:

- **Connectors** — integrations that pull data from external sources (Notion, GitHub, Trello, Gmail) behind a common `IConnector` interface, so new connectors are plug-ins.
- **OAuth vault** — encrypted-at-rest storage and refresh of third-party OAuth tokens.
- **Context assembly** — truncation and relevance filtering of fetched data into a coherent, size-bounded context payload for the model.
- **LLM planning** — orchestrating the model call through the provider abstraction and structuring the response (suggestions, outline, cited sources).

The planning feature is intentionally scoped to help the user *plan and structure* a document, never to *write* it.

### Service boundaries — current and future

The Context module is bounded now so it can become a standalone service later without a rewrite. Keep the boundary in code even though it is one deployment today:

- Its work is driven asynchronously through a **BullMQ job** (enqueued via Redis), never a synchronous in-request call. A user action enqueues a planning job and returns immediately (`202`); the module processes it on a worker and the result is pushed to the browser over WebSocket when ready.
- All connector/LLM logic depends on internal ports (interfaces), not vendor SDKs directly, so the physical location of the implementation can change without touching callers.

**When to actually extract it into its own service** — do this only when a concrete trigger appears, not preemptively:

- OAuth-token isolation becomes a hard security/compliance requirement (the token-holding service must be physically separated from user/session data).
- Connector/LLM workload scales asymmetrically enough to warrant scaling it independently of the rest of the product.
- The connector layer becomes a product in its own right (white-label, third-party exposure).

At that point the extraction is a deployment change, not an architectural one — and the cross-service transport becomes relevant: a **gRPC server-stream** from the extracted Context service back to the Core API, relayed to the browser over the existing WebSocket, so token-by-token LLM output can render incrementally. Until then, gRPC is not needed; inside one process it is just a method call.

### Shared infrastructure

Stateful backing services used by the Core API.

| Component | Role | Notes |
|---|---|---|
| **PostgreSQL** | Primary data store / system of record | All relational, transactional, join-heavy data: users, documents, sections, AI suggestions, connector tokens, gamification, prompts, templates. Freeform-but-bounded fields (mission criteria, template style config) use `JSONB` columns. |
| **MongoDB** | Specialist store | Only two collections, both write-once/read-occasionally freeform blobs: `document_versions` (full snapshot trees, high volume) and `planning_jobs` (Context module job log with evolving per-connector shapes). |
| **Redis** | Queue + cache + rate limiting | BullMQ job state (hard dependency), ephemeral cache with TTL, per-user/per-feature rate-limit counters, session metadata. Not a system of record — recoverable from PostgreSQL. Run with AOF persistence so the job queue survives a restart. |
| **Elasticsearch** | Full-text search | Indexes section content (mirrored from PostgreSQL) with an English analyzer; powers user-facing search over document content. |
| **S3** | File uploads | Object storage for user-uploaded files (PDF/DOCX) and binary assets. |

**Why PostgreSQL primary + MongoDB specialist (not one or the other):** the core data is relational and increasingly transactional (accepting a suggestion atomically updates section content, logs the suggestion, awards XP, and checks mission progress), which is PostgreSQL's strength. The two exception collections are large, append-only, and have schemas defined by external output (LLM responses, connector payloads) that would otherwise force a migration on every connector or output-format change — so they live in MongoDB. The split principle: **stable, queryable, joined/transactional data → PostgreSQL; large freeform write-once blobs → MongoDB.**

### External services

Third-party dependencies, kept behind internal abstractions so the rest of the system depends on stable internal interfaces rather than vendor specifics.

- **LLM API** — the model provider (OpenAI / Anthropic), called through a provider-agnostic gateway so providers are swappable and prompts are versioned.
- **Connectors** — the external systems the Context module integrates with (Notion, GitHub, Trello, Gmail).
- **Monitoring** — observability and error tracking (Sentry for errors, Datadog for metrics/APM).
- **CDN** — delivery of static assets to the browser.

## Request lifecycles

**In-document AI feature (rephrase / tone / structure):**
client selects text → Core API `AI` module validates and rate-limits → calls the LLM through the provider gateway with the active prompt version → logs the suggestion (`ai_suggestions`) → returns the suggestion for inline accept/reject.

**Connector-driven planning:**
client requests a plan → Core API validates JWT and connector permissions → enqueues a BullMQ planning job, returns `202` + jobId → Context module worker fetches connector data, assembles context, calls the LLM → writes `planning_jobs` result in MongoDB → Core API pushes the result to the browser over WebSocket.

## Design principles worth keeping in mind

- **Modular monolith, clean boundaries.** One deployable Core API, domain-isolated modules, no direct cross-module service imports — communicate via domain events. This keeps the option of extracting a module (notably Context) into its own service cheap, without paying the distributed-systems tax before there is a reason to.
- **Async for slow work.** Connector/LLM planning goes through BullMQ, never a synchronous in-request path, so latency-sensitive product calls stay responsive under LLM latency.
- **PostgreSQL is the source of truth.** MongoDB holds only freeform specialist blobs; Redis only accelerates. Losing Redis is an inconvenience; losing PostgreSQL is a crisis. Cross-store references use the same UUIDs as PostgreSQL primary keys, so no ID-translation layer is needed.
- **External dependencies are isolated.** LLM providers, connectors, and monitoring sit behind internal ports/adapters; internal code depends on internal abstractions, not vendor SDKs directly.
- **Streaming stays a Core-API concern at the edge.** The browser always streams from the Core API over WebSocket. If/when the Context module becomes a separate service, it streams back to the Core API over gRPC, which relays — the frontend never learns there is a second service.
- **AI plans, it does not write.** The product deliberately assists structure and clarity; it never generates the user's ideas or drafts their content.
