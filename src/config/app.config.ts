import * as path from 'path';
import { resolveDatabaseType, resolveSqliteDatabasePath } from '@/config/database.config';
import {
  getDefaultDesktopDataDirectory,
  getDesktopBooleanConfigValue,
  getDesktopConfigValue,
  getDesktopNumberConfigValue,
  readDesktopWorkspaceConfig,
} from '@/desktop/desktop-config.util';
import {
  resolveConfiguredStorageRootPath,
  resolveDesktopWhatsAppAutoStart,
} from '@/desktop/desktop-storage.util';

function resolveDesktopWhatsAppSessionPath(): string | null {
  const dataDirectory = getDefaultDesktopDataDirectory();
  if (!dataDirectory) {
    return null;
  }

  return path.join(dataDirectory, 'whatsapp-session');
}

export const appConfig = () => {
  const desktopDataDirectory = getDefaultDesktopDataDirectory();
  const isDesktopWorkspace = Boolean(desktopDataDirectory);
  const workspace = readDesktopWorkspaceConfig();
  const storageRootPath = resolveConfiguredStorageRootPath(workspace);
  const whatsappAutoStart = resolveDesktopWhatsAppAutoStart(workspace);

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    businessTimeZone:
      process.env.BUSINESS_TIMEZONE?.trim() ||
      getDesktopConfigValue('appTimeZone') ||
      process.env.APP_TIMEZONE?.trim() ||
      'Europe/London',
    securityCompanyName: process.env.SECURITY_COMPANY_NAME?.trim() || 'Tech Guards Security',
    trialDays: Number(process.env.TRIAL_DAYS ?? 30),
    licenseSigningSecret: process.env.LICENSE_SIGNING_SECRET?.trim() || 'patrol-evidence-platform-license-secret',
    databaseType: resolveDatabaseType(),
    databasePath: resolveDatabaseType() === 'sqlite' ? resolveSqliteDatabasePath() : null,
    appTimeZone:
      process.env.BUSINESS_TIMEZONE?.trim() ||
      getDesktopConfigValue('appTimeZone') ||
      process.env.APP_TIMEZONE?.trim() ||
      'Europe/London',
    storageRootPath,
    whatsappEnabled: isDesktopWorkspace || process.env.WHATSAPP_ENABLED === 'true',
    whatsappAutoStart,
    whatsappHeadless:
      getDesktopBooleanConfigValue('whatsappHeadless') ??
      (process.env.WHATSAPP_HEADLESS !== undefined ? process.env.WHATSAPP_HEADLESS === 'true' : !isDesktopWorkspace),
    whatsappAllowFromMe:
      getDesktopBooleanConfigValue('whatsappAllowFromMe') ?? (process.env.WHATSAPP_ALLOW_FROM_ME === 'true'),
    whatsappBackfillMessageLimit: Number(process.env.WHATSAPP_BACKFILL_MESSAGE_LIMIT ?? 150),
    whatsappSessionPath:
      resolveDesktopWhatsAppSessionPath() ??
      process.env.WHATSAPP_SESSION_PATH ??
      path.join(process.cwd(), 'whatsapp-session'),
    whatsappChromePath: getDesktopConfigValue('whatsappChromePath') ?? process.env.WHATSAPP_CHROME_PATH,
    whatsappPilotGroupName:
      getDesktopConfigValue('whatsappPilotGroupName') ?? process.env.WHATSAPP_PILOT_GROUP_NAME?.trim(),
    whatsappPilotSiteCode:
      (getDesktopConfigValue('whatsappPilotSiteCode') ?? process.env.WHATSAPP_PILOT_SITE_CODE?.trim().toUpperCase()) ||
      undefined,
    jwtSecret: process.env.JWT_SECRET ?? 'patrol-evidence-platform-dev-secret',
    jwtExpiresInHours: Number(process.env.JWT_EXPIRES_IN_HOURS ?? 12),
  };
};
