import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1783079631964 implements MigrationInterface {
  name = 'CreateUsers1783079631964';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid_generate_v4() lives in the uuid-ossp extension, which is not enabled
    // by default on a fresh Postgres instance. Enable it before it is used.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password_hash" character varying NOT NULL, "display_name" character varying NOT NULL, "role" character varying NOT NULL DEFAULT 'user', "xp" integer NOT NULL DEFAULT '0', "level" integer NOT NULL DEFAULT '1', "last_active_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_38df31b95a25ca0227d1ca6bd0" ON "users"  ("xp") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_38df31b95a25ca0227d1ca6bd0"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
