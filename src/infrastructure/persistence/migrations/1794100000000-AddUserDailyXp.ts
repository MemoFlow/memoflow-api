import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the daily-XP-cap bookkeeping to `users`: `xp_today` (int, default 0)
 * and `xp_today_date` (date, nullable) — XP earned on that UTC day, reset
 * lazily when the date is not today. No backfill needed: 0 / null means
 * "nothing earned yet today".
 *
 * Written in the shape `migration:generate` emits for these two columns.
 */
export class AddUserDailyXp1794100000000 implements MigrationInterface {
  name = 'AddUserDailyXp1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "xp_today" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "xp_today_date" date`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "xp_today_date"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "xp_today"`);
  }
}
