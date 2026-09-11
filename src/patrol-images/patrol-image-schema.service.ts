import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Runtime verification only. The versioned desktop SQLite migration engine
 * owns every schema mutation before Nest starts. */
@Injectable()
export class PatrolImageSchemaService implements OnModuleInit {
  private readonly logger = new Logger(PatrolImageSchemaService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (this.dataSource.options.type !== 'better-sqlite3' && this.dataSource.options.type !== 'sqlite') return;

    const columns = await this.dataSource.query(`PRAGMA table_info("patrol_images")`);
    const names = new Set((columns as Array<{ name: string }>).map((column) => column.name));
    for (const requiredColumn of ['linkedAccountId', 'contentSha256', 'integrityStatus']) {
      if (!names.has(requiredColumn)) {
        throw new Error(`PatrolSafe schema verification failed: patrol_images.${requiredColumn} is missing`);
      }
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

    const indexes = await this.dataSource.query(`PRAGMA index_list("patrol_images")`);
    if (!(indexes as Array<{ name: string }>).some((index) => index.name === 'UQ_patrol_images_whatsapp_identity')) {
      throw new Error('PatrolSafe schema verification failed: evidence identity index is missing');
    }
    this.logger.log('PATROL_IMAGE_IDENTITY_SCHEMA_READY');
  }
}
