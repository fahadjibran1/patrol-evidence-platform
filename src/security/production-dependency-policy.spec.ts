import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

function packageVersion(manifestPath: string): string {
  return JSON.parse(readFileSync(manifestPath, 'utf8')).version as string;
}

describe('production dependency security policy', () => {
  it('uses the reviewed sharp image-decoder release', () => {
    const sharpManifest = join(dirname(dirname(require.resolve('sharp'))), 'package.json');
    expect(packageVersion(sharpManifest)).toBe('0.35.4');
  });

  it('overrides Nest platform-express to the reviewed multer release', () => {
    const platformRequire = createRequire(require.resolve('@nestjs/platform-express/package.json'));
    expect(packageVersion(platformRequire.resolve('multer/package.json'))).toBe('2.3.0');
  });

  it('overrides only the Express legacy route matcher to its patched release', () => {
    const expressRequire = createRequire(require.resolve('express/package.json'));
    expect(packageVersion(expressRequire.resolve('path-to-regexp/package.json'))).toBe('0.1.13');
    expect(packageVersion(require.resolve('path-to-regexp/package.json'))).toBe('3.3.0');
  });

  it('accepts versioned sharp 0.35 Windows native-addon filenames in package verification', () => {
    const verifier = readFileSync('scripts/verify-packaged-app.js', 'utf8');
    expect(verifier).toContain("/^sharp-win32-x64(?:-[0-9.]+)?\\.node$/");
  });
});
