# Authorization and account hardening

Adds role enforcement, data-access tightening, moderation tools, email identity
(unique email, verification, password reset), resource limits and auth hardening. One PR
per phase, each through the standard pipeline in `CLAUDE.md`. Task state lives in
`2026-11-06-authz-hardening.md.tasks.json`.

This repository is public, so this file records the work, not vulnerability details.

## Phases

1. **Operational cleanup.** Rotate shared dev credentials; document seed credentials as local-only.
2. **Roles and access.** `RolesGuard`, admin-only template publishing, admin moderation, tighter user-data responses, disabled accounts, first-admin promotion script, cross-user e2e matrix.
3. **Email identity.** Resend mail adapter, case-insensitive unique email, verification, password reset and change, session invalidation.
4. **Limits.** Input size limits, template pagination, per-user AI quota, per-user storage caps, controlled `scope`/`doc_type`, leaderboard integrity.
5. **Auth hardening.** Socket expiry, logout, per-account login throttling, unsafe-production-config boot checks, password length cap.
6. **Remaining items.** Audit coverage, per-tier broker credentials, Swagger and error-message tightening, connector reconnect review.

## Decisions

- Mail provider: **Resend**, behind a domain port.
- Unique email: **normalized (trim + lowercase) and verified**.
- Published templates: **admin-only**.

Open, to settle before Phase 4: quota numbers; whether registration stays open once
verification exists; whether non-admin users can ever share templates.
