const fs = require('fs');
const path = require('path');

const clientPath = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'Client.js');
const authPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'whatsapp-web.js',
  'src',
  'util',
  'Injected',
  'AuthStore',
  'AuthStore.js',
);

const client = fs.readFileSync(clientPath, 'utf8');
const auth = fs.readFileSync(authPath, 'utf8');

const bad =
  "(window.AuthStore && window.AuthStore.AppState) || window.require('WAWebSocketModel').Socket.state";
const good =
  "((window.AuthStore && window.AuthStore.AppState) || window.require('WAWebSocketModel').Socket).state";

console.log('auth has resolveWaSocket', auth.includes('resolveWaSocket'));
console.log('bad precedence present', client.includes(bad));
console.log('good state expr count', client.split(good).length - 1);
console.log('getState:\n', client.slice(client.indexOf('async getState'), client.indexOf('async getState') + 320));
console.log(
  'needAuth:\n',
  client.slice(client.indexOf('needAuthentication ='), client.indexOf('needAuthentication =') + 480),
);
