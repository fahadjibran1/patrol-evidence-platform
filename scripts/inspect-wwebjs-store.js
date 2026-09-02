const fs = require('fs');
const path = require('path');

const clientPath = path.join('node_modules', 'whatsapp-web.js', 'src', 'Client.js');
const utilsPath = path.join('node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
const authPath = path.join(
  'node_modules',
  'whatsapp-web.js',
  'src',
  'util',
  'Injected',
  'AuthStore',
  'AuthStore.js',
);

const client = fs.readFileSync(clientPath, 'utf8');
const utils = fs.readFileSync(utilsPath, 'utf8');
const auth = fs.readFileSync(authPath, 'utf8');

console.log('AuthStore.js:\n', auth);
console.log('\nExposeStore occurrences in Client.js:', (client.match(/ExposeStore/g) || []).length);
console.log('WAWebSocketModel occurrences in Client.js:', (client.match(/WAWebSocketModel/g) || []).length);

const storeIdx = client.indexOf('window.Store');
console.log('\nClient window.Store snippet:\n', client.slice(storeIdx, storeIdx + 1200));

const requires = new Set();
const re = /require\(['"]([^'"]+)['"]\)/g;
let match;
while ((match = re.exec(utils))) {
  requires.add(match[1]);
}
console.log('\nUtils WA requires:\n', [...requires].filter((name) => name.startsWith('WA')).join('\n'));
