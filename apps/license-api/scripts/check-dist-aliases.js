const fs = require('fs');
const path = require('path');

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(next, acc);
    } else if (next.endsWith('.js')) {
      acc.push(next);
    }
  }
  return acc;
}

const distRoot = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distRoot)) {
  console.error('DIST_MISSING');
  process.exit(1);
}

const files = walk(distRoot);
const hits = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes("require(\"@/") || text.includes("require('@/")) {
    hits.push(file);
  }
}

console.log(`mainExists=${fs.existsSync(path.join(distRoot, 'main.js'))}`);
console.log(
  `nestedExists=${fs.existsSync(path.join(distRoot, 'apps', 'license-api', 'src', 'main.js'))}`,
);
console.log(`unresolvedFiles=${hits.length}`);
for (const hit of hits.slice(0, 20)) {
  console.log(hit);
}

process.exit(hits.length > 0 ? 2 : 0);
