import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScheduleNameAndExpectedGuards1710000008000 implements MigrationInterface {
  name = 'AddScheduleNameAndExpectedGuards1710000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "patrol_schedules"
      ADD COLUMN IF NOT EXISTS "scheduleName" character varying(120) NOT NULL DEFAULT 'Shift'
    `);
    await queryRunner.query(`
      ALTER TABLE "patrol_schedules"
      ADD COLUMN IF NOT EXISTS "expectedGuards" integer NOT NULL DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "patrol_schedules" DROP COLUMN IF EXISTS "expectedGuards"`);
    await queryRunner.query(`ALTER TABLE "patrol_schedules" DROP COLUMN IF EXISTS "scheduleName"`);
  }
}
