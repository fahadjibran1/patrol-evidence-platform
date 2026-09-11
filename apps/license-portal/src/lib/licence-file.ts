/**
 * Browser-side commercial licence file download helpers.
 * Never log or persist the TG1 key outside the caller's controlled memory.
 */

export const LICENCE_FILE_MIME = 'text/plain;charset=utf-8';
export const LICENCE_FILE_EXTENSION = '.lic';

export function buildLicenceFilename(licenseId: string): string {
  const safeId = licenseId.trim().replace(/[^\w.-]+/g, '_');
  return `${safeId}${LICENCE_FILE_EXTENSION}`;
}

export function buildLicenceFileContents(tg1Key: string): string {
  const key = tg1Key.trim();
  if (!key.startsWith('TG1.')) {
    throw new Error('Licence file content must be a TG1 key');
  }
  return `${key}\n`;
}

export interface LicenceDownloadResult {
  fileName: string;
  mimeType: string;
  revoked: boolean;
}

/**
 * Create a UTF-8 .lic Blob, trigger download, and revoke the object URL.
 */
export function downloadLicenceFile(licenseId: string, tg1Key: string): LicenceDownloadResult {
  const fileName = buildLicenceFilename(licenseId);
  const contents = buildLicenceFileContents(tg1Key);
  const blob = new Blob([contents], { type: LICENCE_FILE_MIME });
  const blobUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(blobUrl);
  return { fileName, mimeType: LICENCE_FILE_MIME, revoked: true };
}

export function buildActivationInstructions(input: {
  licenseId: string;
  companyName: string;
  plan: string;
  expiresAtDisplay: string;
}): string {
  return [
    'PatrolSafe by S4 activation',
    '',
    '1. Open PatrolSafe.',
    '2. Go to Licence.',
    '3. Select Activate licence.',
    '4. Open the supplied .lic file in a text editor.',
    '5. Copy the complete TG1 licence key.',
    '6. Paste the key into the activation box.',
    '7. Select Activate.',
    '8. Restart the application if requested.',
    '',
    `Licence ID: ${input.licenseId}`,
    `Licensed company: ${input.companyName}`,
    `Plan: ${input.plan}`,
    `Expiry: ${input.expiresAtDisplay}`,
    '',
  ].join('\n');
}
