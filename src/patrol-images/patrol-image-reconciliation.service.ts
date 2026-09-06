import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PatrolImage } from './entities/patrol-image.entity';

@Injectable()
export class PatrolImageReconciliationService implements OnModuleInit {
  private readonly logger = new Logger(PatrolImageReconciliationService.name);

  constructor(
    @InjectRepository(PatrolImage) private readonly imageRepo: Repository<PatrolImage>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try { await this.reconcile(); } catch (error) {
      this.logger.error(`PATROL_IMAGE_RECONCILIATION_FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async reconcile(): Promise<{ stagingRemoved: number; missing: number; mismatched: number }> {
    const root = path.resolve(this.config.getOrThrow<string>('storageRootPath'));
    const files = await this.walk(root);
    let stagingRemoved = 0;
    for (const file of files) {
      if (path.basename(file).startsWith('.staging-') && path.extname(file) === '.tmp') {
        await fs.unlink(file).catch(() => undefined);
        stagingRemoved += 1;
      }
    }
    const rows = await this.imageRepo.find();
    let missing = 0;
    let mismatched = 0;
    for (const row of rows) {
      try {
        const bytes = await fs.readFile(row.filePath);
        const hashMatches = !row.contentSha256 || createHash('sha256').update(bytes).digest('hex') === row.contentSha256;
        if (!hashMatches) {
          mismatched += 1;
          row.integrityStatus = 'INTEGRITY_FAILED';
          await this.imageRepo.save(row);
          this.logger.error(`PATROL_IMAGE_INTEGRITY_MISMATCH imageId=${row.id}`);
        } else if (row.integrityStatus === 'STAGING') {
          row.integrityStatus = 'FINALIZED';
          await this.imageRepo.save(row);
          this.logger.log(`PATROL_IMAGE_STAGING_FINALIZED imageId=${row.id}`);
        }
      } catch {
        missing += 1;
        row.integrityStatus = 'INTEGRITY_FAILED';
        await this.imageRepo.save(row).catch(() => undefined);
        this.logger.error(`PATROL_IMAGE_FILE_MISSING imageId=${row.id}`);
      }
    }
    this.logger.log(`PATROL_IMAGE_RECONCILIATION_COMPLETE stagingRemoved=${stagingRemoved} missing=${missing} mismatched=${mismatched}`);
    return { stagingRemoved, missing, mismatched };
  }

  private async walk(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[]);
    const result: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) result.push(...(await this.walk(full)));
      else result.push(full);
    }
    return result;
  }
}
