export const LICENCE_IMPORT_MAX_BYTES = 64 * 1024;
export const LICENCE_IMPORT_ACCEPT = '.lic,.txt,text/plain';

const ALLOWED_EXTENSIONS = ['.lic', '.txt'] as const;

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
    return { ok: false, error: 'Unsupported file type. Use a .lic or .txt file.' };
  }

  if (byteLength <= 0) {
    return { ok: false, error: 'Licence file is empty.' };
  }

  if (byteLength > LICENCE_IMPORT_MAX_BYTES) {
    return { ok: false, error: 'Licence file is too large (maximum 64 KB).' };
  }

  const trimmed = contents.trim();
  if (!trimmed) {
    return { ok: false, error: 'Licence file is empty.' };
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length !== 1) {
    return { ok: false, error: 'Licence file must contain a single TG1 key on one line.' };
  }

  const key = lines[0];
  if (!key.startsWith('TG1.')) {
    return { ok: false, error: 'Licence file must begin with TG1.' };
  }

  return { ok: true, key };
}

export async function readLocalLicenceFile(file: File): Promise<LicenceImportResult> {
  if (file.size > LICENCE_IMPORT_MAX_BYTES) {
    return { ok: false, error: 'Licence file is too large (maximum 64 KB).' };
  }

  const contents = await file.text();
  return validateImportedLicenceFile(file.name, contents, file.size);
}
