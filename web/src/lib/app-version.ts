import { PRODUCT_INFO } from './product-info';

declare const __APP_VERSION__: string | undefined;
declare const __APP_BUILD_ID__: string | undefined;

export function getAppVersionLabel(): string {
  if (typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim().length > 0) {
    return __APP_VERSION__.trim();
  }
  return PRODUCT_INFO.version;
}

export function getAppBuildLabel(): string {
  if (typeof __APP_BUILD_ID__ === 'string' && __APP_BUILD_ID__.trim().length > 0) {
    return __APP_BUILD_ID__.trim();
  }
  return PRODUCT_INFO.buildId;
}
