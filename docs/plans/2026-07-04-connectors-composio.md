# Roadmap Item 7 — Connectors via Composio (OAuth2 + MCP selection → context engine)

> Approved plan. Source of truth for task state: `2026-07-04-connectors-composio.md.tasks.json`
> (same dir). Human status: `docs/ROADMAP.md` item 7.

## Context

Roadmap item 7 ("Connectors — OAuth") was originally specced as per-provider OAuth flows
storing **encrypted `connector_tokens`** (AES-256-GCM) in PostgreSQL. Reframed: OAuth2
now runs through **Composio**, inside an **n8n** orchestrator that spins up per-provider
MCP agents (e.g. Trello agent → Composio's Trello MCP fetches). n8n + agents are **out of
scope**.

This API's two jobs:
1. **Connector auth** — drive OAuth2 for a user against a provider **through Composio**.
   Composio is the token vault + MCP host; this API never holds raw provider tokens.
2. **Selection push** — tell the **external context engine API** which connectors / MCP
   references to use for a user's planning run.

Decisions (with the user):
- **No encrypted tokens.** Store only a connection reference (`composio_account_id`,
  provider, status). `connector_tokens` table → `connector_connections`; AES-256-GCM
  mandate no longer applies here.
- **Context engine is a separate service.** Build the outbound push now; the in-process
  `ContextGatherer` port becomes an HTTP adapter to it.
- **Status via webhook + poll fallback.** Composio hosts the provider→Composio callback
  (we never see the `code`); learn `ACTIVE` via Composio **webhook** + **reconcile on
  read**.
- **No landing route.** n8n/Composio owns the browser journey; `initiate` returns
  Composio's `redirectUrl`.
- **Client:** official **`@composio/core`** SDK (infrastructure only).

## Branch 1 — `feature/connector-connections` (foundation: PG + Composio initiate/status)

- **Domain** `src/domain/connectors/`: `connector-connection.entity.ts` (`id, userId,
  provider, composioAccountId, status, createdAt, connectedAt|null, updatedAt`);
  `connector-status.ts` (`enum { Initiated, Active, Revoked, Failed }`);
  `connector-provider.ts` (`enum { Trello, Notion, Github }` allowlist);
  `connector-connection.repository.ts` (interface + `CONNECTOR_CONNECTION_REPOSITORY`:
  `create/findById/findByUserAndProvider/findActiveByUser/upsertInitiated/updateStatus`);
  `connector-gateway.port.ts` (`CONNECTOR_GATEWAY`: `initiateConnection(userId,provider)
  -> {redirectUrl, composioAccountId}`, `getConnectionStatus(composioAccountId) ->
  ConnectorStatus`).
- **Application** `src/application/connectors/`: `initiate-connection.use-case.ts`
  (validate provider, gateway initiate, upsert row `Initiated` idempotent per
  user+provider, return `{redirectUrl, connectionId, status}`; userId from JWT);
  `list-connections.use-case.ts`; `get-connection.use-case.ts` (owner-scoped, mirrors
  `GetPlanningJobUseCase`).
- **Infrastructure**: `connector-connection.orm-entity.ts` (`@Entity('connector_connections')`,
  indexes `user_id`, `provider`, unique `(user_id, provider)`, `status`);
  `connector-connection.typeorm.repository.ts` (23505 → upsert);
  migration `<ts>-CreateConnectorConnections.ts` (generated, same commit);
  `src/infrastructure/connectors/composio.gateway.ts` (`@composio/core`, reads
  `COMPOSIO_API_KEY`/`COMPOSIO_BASE_URL`; **pin the SDK version**).
- **Presentation** `src/presentation/connectors/connectors.controller.ts` (JWT-guarded):
  `POST /connectors/:provider/connect` → 201 `{redirectUrl, connectionId, status}`;
  `GET /connectors`; `GET /connectors/:id` (owner-scoped). DTOs: provider via
  `@IsIn(ConnectorProvider)`; response DTO never exposes tokens.
- **Config**: `COMPOSIO_API_KEY` (required), `COMPOSIO_BASE_URL` (optional) in
  `env.validation.ts` + `.env.example`.
- **Module** `src/connectors.module.ts` (imports `UsersModule`; binds repo + gateway);
  register in `AppModule`.
- **Docs (this branch)**: `docs/database-schema.md` (`connector_tokens` →
  `connector_connections`), `CLAUDE.md` secrets bullet, `docs/ROADMAP.md` item 7, D2
  diagram + SVG.
- **Tests**: use-case unit specs (fake gateway/repo); controller + PG e2e (Composio
  gateway mocked, Testcontainers).

## Branch 2 — `feature/connector-webhook` (status: webhook primary + poll reconcile)

- Extend `ConnectorGateway`: `verifyWebhook(rawBody, signature) -> ComposioEvent`.
- `sync-connection-status.use-case.ts` (apply event / reconcile one connection).
- Reconcile-on-read in `get-connection` + `list-connections` (poll fallback).
- `POST /connectors/webhook` — **public**, HMAC via `COMPOSIO_WEBHOOK_SECRET`; needs
  **raw body** (`NestFactory.create(..., { rawBody: true })` + `RawBodyRequest`).
- `DELETE /connectors/:id` → revoke (Composio disconnect + mark `Revoked`, owner-scoped).
- Config `COMPOSIO_WEBHOOK_SECRET` (required). Tests: signature accept/reject,
  reconcile flips `Initiated`→`Active`, revoke.

## Branch 3 — `feature/connector-context-engine` (selection push)

- Extend `ConnectorGateway`: `getMcpReference(userId, provider) -> {mcpUrl, ...}`.
- Domain `src/domain/context/context-engine.port.ts` (`CONTEXT_ENGINE`:
  `gatherContext({userId, connectors, prompt}) -> Promise<Record<string,unknown>>`).
- Infra `context-engine.http-client.ts` (resolve active connectors + MCP refs, POST
  `{userId, connectors:[{provider,mcpUrl}], prompt}` to `CONTEXT_ENGINE_URL`, auth via
  `CONTEXT_ENGINE_API_KEY` if set).
- `ConnectorContextGatherer implements ContextGatherer` delegating to `ContextEnginePort`;
  rebind `CONTEXT_GATHERER` (ContextModule imports connectors module — no cycle).
  **Stub fallback:** factory picks HTTP adapter when `CONTEXT_ENGINE_URL` set, else
  `StubContextGatherer`. `LlmPlanner` stays stubbed (item 5).
- Config `CONTEXT_ENGINE_URL` (optional; toggles real/stub), `CONTEXT_ENGINE_API_KEY`
  (optional). Tests: resolves only active connectors, request shape, stub fallback.

## Review & commit (each branch, per CLAUDE.md)

`implementer` green (lint/build/unit/e2e) → parallel `code-reviewer` + `api-reviewer`
(+ `tooling-reviewer` for CLAUDE.md, + `docs-maintainer`) → record code-review APPROVE
hash → `/commit` → PR to `development`.

## Verification (end-to-end)

- `npm run lint && npm run build && npm test && npm run test:e2e` green.
- B1 connect: `POST /connectors/trello/connect` (JWT) → Composio `redirectUrl` +
  `connectionId`; row `initiated`; after authorize + reconcile → `active`.
- B2 webhook: signed payload → 200 + `active`; bad signature → 401; poll fallback
  reconciles without webhook.
- B3 push: with `CONTEXT_ENGINE_URL` at a stub receiver, `POST /planning-jobs`
  `connectors:["trello"]` → receiver gets `{userId, connectors:[{provider,mcpUrl}],
  prompt}`; unset URL → echo stub.
- `/docs` lists connector endpoints; no token fields anywhere.
