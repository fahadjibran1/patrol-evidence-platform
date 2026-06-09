declare const __APP_VERSION__: string | undefined;

export function getAppVersionLabel(): string {
  return typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim().length > 0 ? __APP_VERSION__ : 'dev';
}
