import { readFileSync } from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findPrivateKeyViolations } = require('../../scripts/lib/license-public-key.util') as {
  findPrivateKeyViolations: (rootDir: string) => string[];
};

describe('packaged private key absence policy', () => {
  it('keeps private key filenames out of resources and forge ignore policy', () => {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const resourcesDir = path.join(projectRoot, 'resources');
    const violations = findPrivateKeyViolations(resourcesDir);
    expect(violations).toEqual([]);

    const forgeConfig = readFileSync(path.join(projectRoot, 'forge.config.js'), 'utf8');
    expect(forgeConfig).toMatch(/license-private/i);
    expect(forgeConfig).toMatch(/\/tools\(\$\|\\\//);
  });
});
