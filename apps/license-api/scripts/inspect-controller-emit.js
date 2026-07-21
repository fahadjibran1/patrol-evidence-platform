const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, '..', 'dist', 'customers', 'customers.controller.js');
const mapPath = `${jsPath}.map`;
const srcPath = path.join(__dirname, '..', 'src', 'customers', 'customers.controller.ts');

console.log('srcHasAlias', fs.readFileSync(srcPath, 'utf8').includes("from '@/"));
console.log(
  'jsRequires',
  fs
    .readFileSync(jsPath, 'utf8')
    .match(/require\([^)]+\)/g)
    ?.slice(0, 12),
);
if (fs.existsSync(mapPath)) {
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const content = map.sourcesContent?.[0] || '';
  console.log('mapHasAlias', content.includes("from '@/"));
  console.log('mapSources', map.sources);
}
