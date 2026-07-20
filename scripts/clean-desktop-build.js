const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const targets = [
  'dist',
  path.join('web', 'dist'),
  'out',
  // Nest/tsc incremental cache can claim a clean emit after dist/ was wiped.
  'tsconfig.build.tsbuildinfo',
];

if (process.env.SKIP_DESKTOP_CLEAN === 'true') {
  console.log('Skipping desktop clean because SKIP_DESKTOP_CLEAN=true');
  process.exit(0);
}

for (const relativeTarget of targets) {
  const targetPath = path.join(root, relativeTarget);
  if (!fs.existsSync(targetPath)) {
    console.log(`Skip missing: ${relativeTarget}`);
    continue;
  }

  if (relativeTarget === 'out') {
    for (const childName of fs.readdirSync(targetPath)) {
      const childPath = path.join(targetPath, childName);
      fs.rmSync(childPath, { recursive: true, force: true });
    }
    console.log(`Cleared contents: ${relativeTarget}`);
    continue;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  console.log(`Removed: ${relativeTarget}`);
}
