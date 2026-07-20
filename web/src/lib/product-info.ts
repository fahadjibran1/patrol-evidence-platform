export const PRODUCT_INFO = {
  productName: 'Patrol Evidence Platform',
  version: '1.0.0',
  buildId: '2026.07.20.1',
  copyright: '© 2026 TechGuard Security Ltd',
  companyName: 'TechGuard Security Ltd',
  supportEmail: 'support@techguardsecurity.com',
} as const;

export function getAppVersionLabel(): string {
  return PRODUCT_INFO.version;
}

export function getAppBuildLabel(): string {
  return PRODUCT_INFO.buildId;
}
