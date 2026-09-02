import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface PlatformVersionInfo {
  apiVersion: string;
  portalVersion: string;
  customerPortalVersion: string;
  desktopVersion: string;
  databaseMigrationVersion: string | null;
  gitCommit: string | null;
  buildNumber: string;
  buildTimestamp: string;
  environment: string;
  nodeVersion: string;
}

@Injectable()
export class VersionService {
  private readonly buildTimestamp = new Date().toISOString();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async getVersion(): Promise<PlatformVersionInfo> {
    const databaseMigrationVersion = await this.resolveMigrationVersion();
    return {
      apiVersion: this.config.get<string>('APP_VERSION') ?? this.readPackageVersion('apps/license-api') ?? '0.0.0',
      portalVersion:
        this.config.get<string>('ADMIN_PORTAL_VERSION')
        ?? this.readPackageVersion('apps/license-portal')
        ?? '0.0.0',
      customerPortalVersion:
        this.config.get<string>('CUSTOMER_PORTAL_VERSION')
        ?? this.readPackageVersion('apps/customer-portal')
        ?? '0.0.0',
      desktopVersion:
        this.config.get<string>('DESKTOP_VERSION')
        ?? this.readPackageVersion('.')
        ?? '0.0.0',
      databaseMigrationVersion,
      gitCommit: this.config.get<string>('GIT_COMMIT') ?? process.env.GIT_COMMIT ?? null,
      buildNumber: this.config.get<string>('BUILD_NUMBER') ?? 'local',
      buildTimestamp: this.config.get<string>('BUILD_TIMESTAMP') ?? this.buildTimestamp,
      environment: this.config.get<string>('NODE_ENV') ?? 'development',
      nodeVersion: process.version,
    };
  }

  private async resolveMigrationVersion(): Promise<string | null> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
        `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`,
      );
      return rows[0]?.migration_name ?? null;
    } catch {
      return null;
    }
  }

  private readPackageVersion(relativePath: string): string | null {
    try {
      const candidates = [
        join(process.cwd(), relativePath, 'package.json'),
        join(process.cwd(), '..', '..', relativePath, 'package.json'),
        join(__dirname, '..', '..', '..', '..', relativePath, 'package.json'),
      ];
      for (const candidate of candidates) {
        try {
          const raw = readFileSync(candidate, 'utf8');
          const parsed = JSON.parse(raw) as { version?: string };
          if (parsed.version) {
            return parsed.version;
          }
        } catch {
          // try next
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}
