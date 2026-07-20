import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScheduleIs24HoursSiteArchiveRefreshTokens1710000009000 implements MigrationInterface {
  name = 'AddScheduleIs24HoursSiteArchiveRefreshTokens1710000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "patrol_schedules"
      ADD COLUMN IF NOT EXISTS "is24Hours" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "sites"
      ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP WITH TIME ZONE NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "tokenHash" character varying(128) NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revokedAt" TIMESTAMP WITH TIME ZONE NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_refresh_tokens_tokenHash" UNIQUE ("tokenHash"),
        CONSTRAINT "FK_refresh_tokens_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_userId" ON "refresh_tokens" ("userId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
    await queryRunner.query(`ALTER TABLE "sites" DROP COLUMN IF EXISTS "archivedAt"`);
    await queryRunner.query(`ALTER TABLE "patrol_schedules" DROP COLUMN IF EXISTS "is24Hours"`);
  }
}
