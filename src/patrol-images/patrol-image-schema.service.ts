import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Small, explicit desktop-schema guard for evidence identity. TypeORM's
 * synchronize mode may create columns, but this service owns the safety
 * audit and idempotent uniqueness installation.
 */
@Injectable()
export class PatrolImageSchemaService implements OnModuleInit {
  private readonly logger = new Logger(PatrolImageSchemaService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (this.dataSource.options.type !== 'better-sqlite3' && this.dataSource.options.type !== 'sqlite') return;

    const columns = await this.dataSource.query(`PRAGMA table_info("patrol_images")`);
    const names = new Set((columns as Array<{ name: string }>).map((column) => column.name));
    if (!names.has('linkedAccountId')) {
      await this.dataSource.query(`ALTER TABLE "patrol_images" ADD COLUMN "linkedAccountId" varchar(120)`);
    }
    if (!names.has('contentSha256')) {
      await this.dataSource.query(`ALTER TABLE "patrol_images" ADD COLUMN "contentSha256" varchar(64)`);
    }
    if (!names.has('integrityStatus')) {
      await this.dataSource.query(`ALTER TABLE "patrol_images" ADD COLUMN "integrityStatus" varchar(32) NOT NULL DEFAULT 'FINALIZED'`);
    }

    const duplicates = await this.dataSource.query(`
      SELECT "linkedAccountId", "messageExternalId", COUNT(*) AS "count"
      FROM "patrol_images"
      WHERE "collectorType" = 'WHATSAPP'
        AND "linkedAccountId" IS NOT NULL
        AND "messageExternalId" IS NOT NULL
      GROUP BY "linkedAccountId", "messageExternalId"
      HAVING COUNT(*) > 1
    `);
    if (duplicates.length > 0) {
      throw new Error(`Evidence identity migration blocked: ${duplicates.length} duplicate WhatsApp identities require review`);
    }

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_patrol_images_whatsapp_identity"
      ON "patrol_images" ("linkedAccountId", "messageExternalId")
      WHERE "collectorType" = 'WHATSAPP'
        AND "linkedAccountId" IS NOT NULL
        AND "messageExternalId" IS NOT NULL
    `);
    const migrationTable = await this.dataSource.query(`CREATE TABLE IF NOT EXISTS "patrol_schema_migrations" ("id" varchar(160) PRIMARY KEY NOT NULL, "appliedAt" datetime NOT NULL DEFAULT (datetime('now')))`).catch(() => undefined);
    void migrationTable;
    await this.dataSource.query(`INSERT OR IGNORE INTO "patrol_schema_migrations" ("id") VALUES ('patrol-images-identity-v1')`);
    this.logger.log('PATROL_IMAGE_IDENTITY_SCHEMA_READY');
  }
}
