const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const requiredEntries = [
  path.join(projectRoot, 'dist', 'main.js'),
  path.join(projectRoot, 'dist', 'collectors', 'whatsapp-helper.main.js'),
];

const missing = requiredEntries.filter((entryPath) => !fs.existsSync(entryPath));

if (missing.length > 0) {
  console.error('BACKEND DIST ASSERT FAILED: required Nest build outputs are missing:');
  for (const entryPath of missing) {
    console.error(`  - ${entryPath}`);
  }
  console.error(
    'Hint: desktop:clean removes dist/. If TypeScript incremental cache is stale, delete tsconfig.build.tsbuildinfo and rebuild.',
  );
  process.exit(1);
}

console.log(`BACKEND DIST ASSERT OK: ${requiredEntries.map((entry) => path.relative(projectRoot, entry)).join(', ')}`);
