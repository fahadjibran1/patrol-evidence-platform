import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync } from 'fs';
import { DataSource, Repository } from 'typeorm';
import { hashPassword, verifyPassword } from '@/auth/security/password.util';
import { WhatsAppCollectorService } from '@/collectors/whatsapp-collector.service';
import { UserRole } from '@/common/enums/user-role.enum';
import { Company } from '@/companies/entities/company.entity';
import { User } from '@/users/entities/user.entity';
import { resolveDatabaseType, resolveSqliteDatabasePath, SupportedDatabaseType } from '@/config/database.config';
import { LicenseSnapshot, LicensingService } from '@/licensing/licensing.service';
import { WhatsAppSourceMappingService } from '@/patrol-groups/whatsapp-source-mapping.service';
import { PatrolSchedule } from '@/patrol-schedules/entities/patrol-schedule.entity';
import {
  DesktopWorkspaceConfig,
  loadDesktopWorkspaceConfig,
  mergeDesktopWorkspaceConfig,
  normalizeDesktopSetupStage,
  normalizeSetupCompleted,
  readDesktopWorkspaceConfig,
  resolveWorkspaceTimeZone,
  writeDesktopWorkspaceConfigFile,
} from './desktop-config.util';
import { assertIanaTimeZone } from '@/common/utils/patrol-time.util';
import {
  applyStorageRootPath,
  resolveConfiguredStorageRootPath,
  resolveDesktopWhatsAppAutoStart,
  storagePathsMatch,
} from './desktop-storage.util';
import { InitializeDesktopWorkspaceDto } from './dto/initialize-desktop-workspace.dto';
import { ResetDesktopAdminPasswordDto } from './dto/reset-desktop-admin-password.dto';
import { UpdateDesktopLicenseDto } from './dto/update-desktop-license.dto';
import { VerifyDesktopSetupDto } from './dto/verify-desktop-setup.dto';

export interface DesktopSetupVerificationCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface DesktopSetupVerificationResult {
  passed: boolean;
  checks: DesktopSetupVerificationCheck[];
}

export interface DesktopBootstrapStatus {
  desktopMode: boolean;
  configPath: string | null;
  setupCompleted: boolean;
  setupStage: ReturnType<typeof normalizeDesktopSetupStage>;
  workspaceName: string | null;
  storageRootPath: string | null;
  activeStorageRootPath: string | null;
  patrolImageStoragePath: string | null;
  companyName: string | null;
  localAdminEmail: string | null;
  dbConfigured: boolean;
  dbType: SupportedDatabaseType;
  databasePath: string | null;
  databaseReady: boolean;
  databaseFileCreated: boolean;
  schemaReady: boolean;
  hasCompany: boolean;
  hasCompanyAdmin: boolean;
  autoLaunchApp: boolean;
  autoStartCollector: boolean;
  whatsappAllowFromMe: boolean;
  linkedWhatsAppAccountId: string | null;
  appTimeZone: string | null;
  settingsApplied: boolean;
  unresolvedMappingConflicts: number;
  license: LicenseSnapshot;
}

@Injectable()
export class DesktopService {
  private readonly logger = new Logger(DesktopService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly licensingService: LicensingService,
    private readonly dataSource: DataSource,
    private readonly whatsAppCollectorService: WhatsAppCollectorService,
    private readonly whatsAppSourceMappingService: WhatsAppSourceMappingService,
    @InjectRepository(Company)
    private readonly companiesRepo: Repository<Company>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(PatrolSchedule)
    private readonly patrolScheduleRepo: Repository<PatrolSchedule>,
  ) {}

  async getBootstrapStatus(): Promise<DesktopBootstrapStatus> {
    const workspace = readDesktopWorkspaceConfig();
    const setupCompleted = normalizeSetupCompleted(workspace.setupCompleted);
    this.logger.log(`SETUP_COMPLETED_LOADED ${setupCompleted ? 'true' : 'false'}`);
    const companyName = workspace.companyName?.trim() || null;
    const localAdminEmail = workspace.localAdminEmail?.trim().toLowerCase() || null;
    const configuredStorageRootPath = workspace.storageRootPath?.trim() || null;
    const activeStorageRootPath =
      this.configService.get<string>('storageRootPath')?.trim() || resolveConfiguredStorageRootPath(workspace);
    const dbType = resolveDatabaseType();
    const databasePath =
      dbType === 'sqlite'
        ? this.configService.get<string>('databasePath')?.trim() || resolveSqliteDatabasePath()
        : null;
    const dbConfigured =
      dbType === 'sqlite'
        ? true
        : Boolean(
            workspace.dbHost?.trim() ||
              process.env.DB_HOST?.trim(),
          );
    const databaseStatus = await this.getDatabaseStatus(dbType, databasePath);
    const unresolvedMappingConflicts = await this.getUnresolvedMappingConflictCount();

    const company = companyName
      ? await this.companiesRepo.findOne({
          where: { companyName },
        })
      : null;

    const companyAdmin = localAdminEmail
      ? await this.usersRepo.findOne({
          where: { email: localAdminEmail },
        })
      : null;
    const license = this.licensingService.getLicenseSnapshot(companyName, workspace);

    const settingsApplied =
      !configuredStorageRootPath ||
      storagePathsMatch(configuredStorageRootPath, activeStorageRootPath);

    return {
      desktopMode: Boolean(process.env.DESKTOP_CONFIG_PATH),
      configPath: process.env.DESKTOP_CONFIG_PATH ?? null,
      setupCompleted,
      setupStage: setupCompleted ? 'complete' : normalizeDesktopSetupStage(workspace.setupStage),
      workspaceName: workspace.workspaceName?.trim() || null,
      storageRootPath: configuredStorageRootPath,
      activeStorageRootPath,
      patrolImageStoragePath: activeStorageRootPath,
      companyName,
      localAdminEmail,
      dbConfigured,
      dbType,
      databasePath,
      databaseReady: databaseStatus.databaseReady,
      databaseFileCreated: databaseStatus.databaseFileCreated,
      schemaReady: databaseStatus.schemaReady,
      hasCompany: Boolean(company),
      hasCompanyAdmin: Boolean(companyAdmin),
      autoLaunchApp: workspace.autoLaunchApp === true,
      autoStartCollector: resolveDesktopWhatsAppAutoStart(workspace),
      whatsappAllowFromMe: workspace.whatsappAllowFromMe === true,
      linkedWhatsAppAccountId: workspace.linkedWhatsAppAccountId?.trim() || null,
      appTimeZone: workspace.appTimeZone ? assertIanaTimeZone(workspace.appTimeZone) : null,
      settingsApplied,
      unresolvedMappingConflicts,
      license,
    };
  }

  private async getUnresolvedMappingConflictCount(): Promise<number> {
    if (!this.dataSource.isInitialized) return 0;
    try {
      const rows = await this.dataSource.query(
        `SELECT COUNT(*) AS "count" FROM "patrol_migration_conflicts" WHERE "resolvedAt" IS NULL`,
      ) as Array<{ count?: number | string }>;
      return Number(rows[0]?.count ?? 0);
    } catch {
      return 0;
    }
  }

  async initializeWorkspace(dto: InitializeDesktopWorkspaceDto): Promise<DesktopBootstrapStatus> {
    const workspace = readDesktopWorkspaceConfig();
    let appTimeZone: string;
    try {
      appTimeZone = assertIanaTimeZone(dto.appTimeZone);
    } catch {
      throw new BadRequestException('Choose a valid time zone from the list.');
    }
    const companyName = dto.companyName.trim();
    const email = dto.adminEmail.trim().toLowerCase();
    const storageRootPath = dto.storageRootPath?.trim()
      ? applyStorageRootPath(dto.storageRootPath)
      : workspace.storageRootPath?.trim()
        ? applyStorageRootPath(workspace.storageRootPath)
        : undefined;

    if (storageRootPath) {
      this.logger.log(`storage-folder-selected path=${storageRootPath}`);
      this.logger.log(`storage-folder-applied path=${storageRootPath}`);
    }

    const company = await this.ensureCompany(companyName);
    const adminCreated = await this.upsertSetupAdmin({
      email,
      password: dto.adminPassword,
      firstName: dto.adminFirstName.trim(),
      lastName: dto.adminLastName.trim(),
      companyId: company.id,
    });

    const loginVerified = await this.verifySetupAdminLogin(email, dto.adminPassword);
    if (!loginVerified) {
      throw new BadRequestException(
        'Setup admin account was saved but login verification failed. Restart the app and try again.',
      );
    }

    this.logger.log(`ADMIN_LOGIN_TEST_OK email=${email} created=${adminCreated ? 'yes' : 'no'}`);

    if (!process.env.DESKTOP_CONFIG_PATH) {
      return this.getBootstrapStatus();
    }

    const activation = dto.licenseKey?.trim()
      ? this.licensingService.activateLicense(companyName, dto.licenseKey.trim(), workspace)
      : null;

    const sqliteDbPath = workspace.sqliteDbPath?.trim() || resolveSqliteDatabasePath();

    const nextConfig = mergeDesktopWorkspaceConfig(workspace, {
      setupCompleted: dto.markSetupComplete === true ? true : normalizeSetupCompleted(workspace.setupCompleted),
      setupStage: dto.markSetupComplete === true ? 'complete' : 'storage',
      workspaceName: dto.workspaceName?.trim() || companyName,
      appTimeZone,
      companyName,
      licenseKey: activation?.configPatch.licenseKey ?? dto.licenseKey?.trim() ?? workspace.licenseKey,
      licenseType: activation?.configPatch.licenseType ?? workspace.licenseType,
      trialStartDate: activation?.configPatch.trialStartDate ?? workspace.trialStartDate,
      trialEndDate: activation?.configPatch.trialEndDate ?? workspace.trialEndDate,
      licenseStatus: activation?.configPatch.licenseStatus ?? workspace.licenseStatus,
      licenseCreatedAt: activation?.configPatch.licenseCreatedAt ?? workspace.licenseCreatedAt,
      licenseUpdatedAt: activation?.configPatch.licenseUpdatedAt ?? workspace.licenseUpdatedAt,
      storageRootPath,
      dbType: workspace.dbType ?? 'sqlite',
      sqliteDbPath,
      localAdminEmail: email,
      localAdminFirstName: dto.adminFirstName.trim(),
      localAdminLastName: dto.adminLastName.trim(),
      // Retain the legacy field for config compatibility, but desktop linking is user initiated.
      autoStartCollector: false,
      autoLaunchApp: dto.autoLaunchApp === true,
      whatsappAllowFromMe: dto.whatsappAllowFromMe === true,
      lastSetupAt: new Date().toISOString(),
    });

    this.writeWorkspaceConfigFile(nextConfig);

    const status = await this.getBootstrapStatus();
    if (storageRootPath && !storagePathsMatch(storageRootPath, status.activeStorageRootPath ?? '')) {
      throw new BadRequestException(
        `Storage folder was saved in setup config but the running backend is still using ${status.activeStorageRootPath}. Restart app services and try again.`,
      );
    }

    return status;
  }

  async completeSetup(): Promise<DesktopBootstrapStatus> {
    if (!process.env.DESKTOP_CONFIG_PATH) {
      throw new BadRequestException('Desktop setup completion is only available in the installed app');
    }

    const workspace = readDesktopWorkspaceConfig();
    try {
      resolveWorkspaceTimeZone(workspace);
    } catch {
      throw new BadRequestException('Choose a valid workspace time zone before completing setup.');
    }
    const adminEmail = workspace.localAdminEmail?.trim().toLowerCase();
    if (adminEmail) {
      const adminUser = await this.usersRepo.findOne({ where: { email: adminEmail } });
      if (!adminUser) {
        this.logger.error(`ADMIN_LOGIN_TEST_FAILED reason=admin-missing email=${adminEmail}`);
        throw new BadRequestException(
          'Company admin account was not found in the local database. Return to step 1 and save company details again.',
        );
      }

      this.logger.log(`ADMIN_LOGIN_TEST_OK email=${adminEmail} source=complete-setup`);
    } else {
      this.logger.error('ADMIN_LOGIN_TEST_FAILED reason=admin-email-missing-in-workspace-config');
      throw new BadRequestException('Company admin email is missing from workspace config. Save company details again.');
    }

    this.writeWorkspaceConfigFile({
      setupCompleted: true,
      setupStage: 'complete',
      lastSetupAt: new Date().toISOString(),
    });
    this.logger.log('desktop-setup-completed');
    return this.getBootstrapStatus();
  }

  async resetAdminPassword(dto: ResetDesktopAdminPasswordDto): Promise<{ ok: true; email: string }> {
    if (!process.env.DESKTOP_CONFIG_PATH) {
      throw new BadRequestException('Admin password reset is only available in the desktop app');
    }

    if (dto.confirmed !== true) {
      throw new BadRequestException('Password reset was not confirmed');
    }

    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const workspace = readDesktopWorkspaceConfig();
    const email = workspace.localAdminEmail?.trim().toLowerCase();
    if (!email) {
      this.logger.error('ADMIN_PASSWORD_RESET_FAILED reason=admin-email-missing');
      throw new BadRequestException('No company admin email found in workspace config');
    }

    try {
      const adminUser = await this.usersRepo.findOne({ where: { email } });
      if (!adminUser) {
        this.logger.error(`ADMIN_PASSWORD_RESET_FAILED reason=admin-not-found email=${email}`);
        throw new BadRequestException('Company admin account was not found in the local database');
      }

      adminUser.passwordHash = await hashPassword(dto.newPassword);
      await this.usersRepo.save(adminUser);
      this.logger.log(`ADMIN_PASSWORD_RESET_OK email=${email}`);
      return { ok: true, email };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`ADMIN_PASSWORD_RESET_FAILED reason=${message}`);
      throw new BadRequestException('Failed to reset admin password');
    }
  }

  async verifySetupConfiguration(dto: VerifyDesktopSetupDto): Promise<DesktopSetupVerificationResult> {
    const checks: DesktopSetupVerificationCheck[] = [];
    const status = await this.getBootstrapStatus();
    const collectorStatus = await this.whatsAppCollectorService.getStatus();

    if (collectorStatus.ready && collectorStatus.connectedAccount?.trim()) {
      await this.whatsAppSourceMappingService.persistLinkedWhatsAppAccount(
        collectorStatus.connectedAccount.trim(),
      );
    }

    const linkedAccountId = this.whatsAppSourceMappingService.resolveActiveLinkedAccountId(
      collectorStatus.connectedAccount,
    );

    checks.push({
      name: 'whatsapp-live',
      passed: collectorStatus.ready === true,
      message: collectorStatus.ready
        ? 'WhatsApp patrol monitoring is connected and ready.'
        : `WhatsApp is not ready (${collectorStatus.state}). Connect WhatsApp before testing.`,
    });

    checks.push({
      name: 'linked-account-set',
      passed: Boolean(linkedAccountId),
      message: linkedAccountId
        ? `Linked WhatsApp account: ${linkedAccountId}`
        : 'No linked WhatsApp account recorded yet. Connect WhatsApp before mapping sources.',
    });

    if (linkedAccountId && collectorStatus.connectedAccount && collectorStatus.connectedAccount !== linkedAccountId) {
      checks.push({
        name: 'linked-account-matches',
        passed: false,
        message: `Connected account (${collectorStatus.connectedAccount}) does not match linked account (${linkedAccountId}). Reconnect WhatsApp or remap sources.`,
      });
    } else if (linkedAccountId) {
      checks.push({
        name: 'linked-account-matches',
        passed: true,
        message: 'Connected WhatsApp account matches the linked workspace account.',
      });
    }

    const mappedSources = await this.whatsAppSourceMappingService.findActiveMappingsForIngest(linkedAccountId);

    checks.push({
      name: 'source-mapped',
      passed: mappedSources.length > 0,
      message:
        mappedSources.length > 0
          ? `${mappedSources.length} WhatsApp source(s) mapped for the linked account.`
          : 'No WhatsApp source mapped for the linked account. Map a detected group or contact to your site.',
    });

    const configuredStorage = status.storageRootPath?.trim();
    if (configuredStorage) {
      try {
        applyStorageRootPath(configuredStorage);
        checks.push({
          name: 'storage-writable',
          passed: true,
          message: `Selected storage folder is writable: ${configuredStorage}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        checks.push({
          name: 'storage-writable',
          passed: false,
          message,
        });
      }
    } else {
      checks.push({
        name: 'storage-writable',
        passed: false,
        message: 'No patrol image storage folder selected.',
      });
    }

    checks.push({
      name: 'storage-path-active',
      passed: Boolean(status.activeStorageRootPath) && status.settingsApplied,
      message: status.settingsApplied
        ? `Active patrol image path: ${status.activeStorageRootPath}`
        : `Backend is not using the selected storage folder (${status.activeStorageRootPath ?? 'unset'}). Restart app services.`,
    });

    const scheduleCount = await this.patrolScheduleRepo.count({ where: { active: true } });
    checks.push({
      name: 'schedule-exists',
      passed: scheduleCount > 0,
      message:
        scheduleCount > 0
          ? `${scheduleCount} active patrol schedule(s) configured.`
          : 'No patrol schedule saved yet.',
    });

    const testSource = mappedSources[0];
    const testSiteCode = dto.siteCode?.trim().toUpperCase() || testSource?.site?.siteCode?.trim().toUpperCase();
    const testExternalGroupId = dto.externalGroupId?.trim() || testSource?.externalGroupId?.trim();

    if (testSiteCode && testExternalGroupId) {
      try {
        const result = await this.whatsAppCollectorService.simulateLiveImageIngestForAdmin({
          siteCode: testSiteCode,
          externalGroupId: testExternalGroupId,
        });
        checks.push({
          name: 'test-image-saved',
          passed: Boolean(result.imageId),
          message: result.duplicate
            ? `Test image ingest OK (duplicate detected). Image ID: ${result.imageId}`
            : `Test image saved successfully. Image ID: ${result.imageId}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        checks.push({
          name: 'test-image-saved',
          passed: false,
          message: `Test image ingest failed: ${message}`,
        });
      }
    } else {
      checks.push({
        name: 'test-image-saved',
        passed: false,
        message: 'Cannot save test image until a WhatsApp source is mapped to a site.',
      });
    }

    return {
      passed: checks.every((check) => check.passed),
      checks,
    };
  }

  private async ensureCompany(companyName: string): Promise<Company> {
    let company = await this.companiesRepo.findOne({
      where: { companyName },
    });

    if (!company) {
      company = await this.companiesRepo.save(
        this.companiesRepo.create({
          companyName,
          active: true,
        }),
      );
    }

    return company;
  }

  private async upsertSetupAdmin(params: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    companyId: string;
  }): Promise<boolean> {
    let adminUser = await this.usersRepo.findOne({
      where: { email: params.email },
    });

    if (adminUser && adminUser.role !== UserRole.COMPANY_ADMIN && adminUser.role !== UserRole.ADMIN) {
      throw new BadRequestException('Existing user email is already assigned to a non-admin role');
    }

    const passwordHash = await hashPassword(params.password);
    const created = !adminUser;

    if (!adminUser) {
      adminUser = this.usersRepo.create({
        email: params.email,
        passwordHash,
        firstName: params.firstName,
        lastName: params.lastName,
        role: UserRole.COMPANY_ADMIN,
        companyId: params.companyId,
        active: true,
        approved: true,
      });
      this.logger.log(`setup-admin-created email=${params.email} companyId=${params.companyId}`);
    } else {
      adminUser = this.usersRepo.merge(adminUser, {
        passwordHash,
        firstName: params.firstName,
        lastName: params.lastName,
        role: UserRole.COMPANY_ADMIN,
        companyId: params.companyId,
        active: true,
        approved: true,
      });
      this.logger.log(`setup-admin-updated email=${params.email} companyId=${params.companyId}`);
    }

    await this.usersRepo.save(adminUser);
    return created;
  }

  private async verifySetupAdminLogin(email: string, password: string): Promise<boolean> {
    const normalizedEmail = email.trim().toLowerCase();
    const adminUser = await this.usersRepo.findOne({
      where: { email: normalizedEmail },
    });

    if (!adminUser) {
      this.logger.error(`ADMIN_LOGIN_TEST_FAILED reason=user-not-found email=${normalizedEmail}`);
      return false;
    }

    const passwordMatches = await verifyPassword(password, adminUser.passwordHash);
    if (!passwordMatches) {
      this.logger.error(`ADMIN_LOGIN_TEST_FAILED reason=password-mismatch email=${normalizedEmail}`);
    }

    return passwordMatches;
  }

  private writeWorkspaceConfigFile(patch: DesktopWorkspaceConfig): void {
    const configPath = process.env.DESKTOP_CONFIG_PATH;
    if (!configPath) {
      return;
    }

    const current = loadDesktopWorkspaceConfig(configPath);
    const nextConfig = mergeDesktopWorkspaceConfig(current, patch);
    writeDesktopWorkspaceConfigFile(configPath, nextConfig);

    if (normalizeSetupCompleted(nextConfig.setupCompleted)) {
      this.logger.log('SETUP_COMPLETED_SAVED true');
    }
  }

  async updateLicense(dto: UpdateDesktopLicenseDto): Promise<DesktopBootstrapStatus> {
    if (!process.env.DESKTOP_CONFIG_PATH) {
      throw new BadRequestException('Desktop licence updates are only available in the installed app');
    }

    const workspace = readDesktopWorkspaceConfig();
    const activation = this.licensingService.activateLicense(dto.companyName.trim(), dto.licenseKey.trim(), workspace);
    const nextConfig = {
      ...workspace,
      companyName: dto.companyName.trim(),
      ...activation.configPatch,
    };

    writeDesktopWorkspaceConfigFile(process.env.DESKTOP_CONFIG_PATH, nextConfig);

    return this.getBootstrapStatus();
  }

  private async getDatabaseStatus(
    dbType: SupportedDatabaseType,
    databasePath: string | null,
  ): Promise<{
    databaseReady: boolean;
    databaseFileCreated: boolean;
    schemaReady: boolean;
  }> {
    if (!this.dataSource.isInitialized) {
      return {
        databaseReady: false,
        databaseFileCreated: dbType === 'sqlite' ? Boolean(databasePath && existsSync(databasePath)) : false,
        schemaReady: false,
      };
    }

    const requiredTables = this.dataSource.entityMetadatas
      .map((metadata) => metadata.tableName)
      .filter((tableName) => !tableName.startsWith('sqlite_'));

    if (requiredTables.length === 0) {
      return {
        databaseReady: true,
        databaseFileCreated: dbType === 'sqlite' ? Boolean(databasePath && existsSync(databasePath)) : true,
        schemaReady: true,
      };
    }

    const existingTables = new Set(await this.listExistingTables(dbType));
    const schemaReady = requiredTables.every((tableName) => existingTables.has(tableName));

    return {
      databaseReady: true,
      databaseFileCreated: dbType === 'sqlite' ? Boolean(databasePath && existsSync(databasePath)) : true,
      schemaReady,
    };
  }

  private async listExistingTables(dbType: SupportedDatabaseType): Promise<string[]> {
    if (dbType === 'sqlite') {
      const rows = await this.dataSource.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      );
      return rows.map((row: { name: string }) => row.name);
    }

    const rows = await this.dataSource.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    return rows.map((row: { table_name: string }) => row.table_name);
  }
}
