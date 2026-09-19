export const LICENCE_IMPORT_MAX_BYTES = 256 * 1024;
export const LICENCE_IMPORT_ACCEPT = '.tglic';

const ALLOWED_EXTENSIONS = ['.tglic', '.lic', '.txt', '.json'] as const;

export type LicenceImportResult =
  | { ok: true; key: string }
  | { ok: false; error: string };

export function validateImportedLicenceFile(
  fileName: string,
  contents: string,
  byteLength: number,
): LicenceImportResult {
  const lower = fileName.trim().toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension));
  if (!hasAllowedExtension) {
    return { ok: false, error: 'Unsupported file type. Use a .tglic licence file.' };
  }

  if (byteLength <= 0) {
    return { ok: false, error: 'Licence file is empty.' };
  }

  if (byteLength > LICENCE_IMPORT_MAX_BYTES) {
    return { ok: false, error: 'Licence file is too large (maximum 256 KB).' };
  }

  const trimmed = contents.trim();
  if (!trimmed) {
    return { ok: false, error: 'Licence file is empty.' };
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { payload?: unknown; signature?: unknown };
      if (!parsed.payload || typeof parsed.signature !== 'string') {
        return { ok: false, error: 'Commercial licence file must include payload and signature.' };
      }
      return { ok: true, key: trimmed };
    } catch {
      return { ok: false, error: 'Licence file is not valid JSON.' };
    }
  }

  return { ok: false, error: 'Licence file must be a commercial .tglic JSON document.' };
}

export async function readLocalLicenceFile(file: File): Promise<LicenceImportResult> {
  if (file.size > LICENCE_IMPORT_MAX_BYTES) {
    return { ok: false, error: 'Licence file is too large (maximum 256 KB).' };
  }

  const contents = await file.text();
  return validateImportedLicenceFile(file.name, contents, file.size);
}
