export const PRODUCT_INFO = {
  productName: 'PatrolSafe by S4',
  brandName: 'PatrolSafe',
  endorsement: 'by S4',
  tagline: 'Patrol evidence. Automatically organised.',
  version: '1.0.0',
  buildId: '2026.07.20.1',
  copyright: '© 2026 Vesoft Services Limited. All rights reserved.',
  companyName: 'Vesoft Services Limited',
  supportEmail: 'support@techguardsecurity.com',
} as const;

export function getAppVersionLabel(): string {
  return PRODUCT_INFO.version;
}

export function getAppBuildLabel(): string {
  return PRODUCT_INFO.buildId;
}
