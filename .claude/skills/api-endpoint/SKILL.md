---
name: api-endpoint
description: Add a single REST endpoint to an existing MemoFlow module — use-case, controller method, DTOs, and tests, following the project's clean-architecture conventions. Use for individual endpoints; use /new-module for whole new features.
argument-hint: <module> <verb> <path>
---

# /api-endpoint — add one endpoint to an existing module

Add endpoint `$2 $3` to module `$1`. The module's four layers must already exist
(`/new-module` creates them); if they don't, stop and suggest `/new-module`.

## Steps

1. **Locate the slice**: `src/domain/$1/`, `src/application/$1/`,
   `src/infrastructure/persistence/$1/`, `src/presentation/$1/`. Read the existing
   use-cases and controller to match naming and style.
2. **Use-case** — `src/application/$1/<action>.use-case.ts`: `@Injectable()`, depends
   on repository interfaces only. If the repository interface needs a new method, add
   it to the domain interface AND implement it in the infrastructure repository.
   Never bypass the interface. Validate cross-DB uuid references here if applicable.
3. **DTOs** — `src/presentation/$1/dto/`: request DTO with class-validator +
   `@ApiProperty()` on every field; response DTO that never leaks `password_hash`
   or secrets. Path params validated too (`ParseUUIDPipe` for uuid params).
4. **Controller method** — thin: map DTO → use-case call → response DTO. Add
   `@ApiOperation` and `@ApiResponse` annotations. Errors: throw Nest HTTP exceptions
   (the global filter shapes them).
5. **Tests** — unit test for the use-case (fake repository); extend the module's
   e2e spec with the new route (happy path + one validation-failure case).
6. **Verify** — `npm run lint && npm run build && npm test`. If the repository
   changed a PG entity, generate a migration
   (`npm run migration:generate -- src/infrastructure/persistence/migrations/<Name>`).
7. Remind the user to run the `api-reviewer` agent before committing.
