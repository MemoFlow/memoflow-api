---
name: new-module
description: Scaffold a new MemoFlow feature module as a clean-architecture vertical slice (domain, application, infrastructure, presentation) backed by PostgreSQL (TypeORM) or MongoDB (Mongoose). Use when adding a new entity/feature module.
argument-hint: <name> --db pg|mongo [field:type ...]
---

# /new-module — scaffold a feature slice

Generate a complete vertical slice for feature `$1` following the architecture rules
in CLAUDE.md and the data design in `docs/database-schema.md`.

## Resolve inputs first

1. **Name**: kebab-case feature name (e.g. `users`, `document-versions`). Singular
   class names (`User`), plural table/collection names (`users`).
2. **Database**: from `--db pg|mongo`. If omitted, look the entity up in
   `docs/database-schema.md` and use the database it is assigned to there
   (e.g. `users` → pg, `document-versions` → mongo). If the entity is not in the
   schema doc, STOP and ask the user — new entities require a schema-doc update first.
3. **Fields**: from remaining `field:type` args, or from the schema doc's table for
   this entity. The schema doc wins on indexes and column types.

## Files to generate (all four layers)

### 1. Domain — `src/domain/<feature>/`
- `<name>.entity.ts` — plain TypeScript class (NO typeorm/mongoose imports), fields per schema doc.
- `<name>.repository.ts` — repository interface + injection token:
  ```ts
  export const USER_REPOSITORY = Symbol('UserRepository');
  export interface UserRepository {
    findById(id: string): Promise<User | null>;
    // ... per use-cases
  }
  ```

### 2. Application — `src/application/<feature>/`
- One class per use-case (e.g. `create-user.use-case.ts`), `@Injectable()`, injecting
  the repository interface via its token. Business rules live here.
- **Cross-DB rule:** if this is a Mongo-backed module whose documents carry PG uuids
  (`user_id`, `document_id`), the use-case MUST validate those rows exist (via the
  corresponding PG repository interface) before writing.
- Unit test per use-case (`*.spec.ts`) with an in-memory fake of the repository interface.

### 3. Infrastructure — `src/infrastructure/persistence/<feature>/`

**PG path (`--db pg`):**
- `<name>.orm-entity.ts` — TypeORM `@Entity('<table>')` with columns, `@Index()` per the schema doc, uuid PK (`@PrimaryGeneratedColumn('uuid')`).
- `<name>.typeorm.repository.ts` — implements the domain interface using `Repository<OrmEntity>`; maps orm-entity ↔ domain entity.
- **Generate a migration**: `npm run migration:generate -- src/infrastructure/persistence/migrations/Create<Name>` (requires PG up: `npm run db:up`). The migration ships in the same commit — `synchronize` is off.

**Mongo path (`--db mongo`):**
- `<name>.schema.ts` — `@Schema({ collection: '<collection>' })` + `SchemaFactory`, `HydratedDocument<T>` for the doc type, `@Prop({ index: true })` per the schema doc. Cross-DB uuids are plain indexed strings.
- `<name>.mongoose.repository.ts` — implements the domain interface via `@InjectModel`.

### 4. Presentation — `src/presentation/<feature>/`
- `dto/` — request/response DTOs: every field has class-validator decorators AND `@ApiProperty()`. Response DTOs never expose `password_hash` or token/secret fields.
- `<name>.controller.ts` — `@ApiTags('<feature>')`, thin methods calling use-cases only.

### 5. Wiring + tests
- `src/<name>.module.ts` (or extend feature module) — binds the repository token to the implementation (`{ provide: USER_REPOSITORY, useClass: ... }`), registers `TypeOrmModule.forFeature([...])` or `MongooseModule.forFeature([...])`, declares controller + use-cases. Import into `AppModule`.
- e2e spec in `test/<feature>.e2e-spec.ts` modeled on `test/app.e2e-spec.ts`: use `test/utils/pg-testcontainer.ts` (with the Docker-availability gate) and/or `test/utils/mongo-memory.ts`.

## After generating

1. `npm run lint && npm run build && npm test`
2. PG modules: verify the generated migration with `npm run migration:show` / `migration:run`.
3. Remind the user to run the `api-reviewer` agent before committing.
