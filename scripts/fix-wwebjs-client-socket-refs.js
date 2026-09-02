const fs = require('fs');
const path = require('path');

const clientPath = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'Client.js');
let client = fs.readFileSync(clientPath, 'utf8');

const brokenState =
  "(window.AuthStore && window.AuthStore.AppState) || window.require('WAWebSocketModel').Socket.state";
const fixedState =
  "((window.AuthStore && window.AuthStore.AppState) || window.require('WAWebSocketModel').Socket).state";
const brokenSocket =
  "(window.AuthStore && window.AuthStore.AppState) || window.require('WAWebSocketModel').Socket";
const fixedSocket =
  "((window.AuthStore && window.AuthStore.AppState) || window.require('WAWebSocketModel').Socket)";

while (client.includes(brokenState)) {
  client = client.replace(brokenState, fixedState);
}

client = client.split(fixedState).join('__FIXED_STATE__');
while (client.includes(brokenSocket)) {
  client = client.replace(brokenSocket, fixedSocket);
}
client = client.split('__FIXED_STATE__').join(fixedState);

client = client.replace(/window\s*\n\s*\.AuthStore\.AppState/g, 'window.AuthStore.AppState');

fs.writeFileSync(clientPath, client, 'utf8');

console.log('fixed state count', (client.match(/AuthStore\.AppState\)\)\.state/g) || []).length);
console.log('getState snippet:\n', client.slice(client.indexOf('async getState'), client.indexOf('async getState') + 320));
console.log(
  'remaining bare broken',
  client.includes(brokenState),
  client.includes(brokenSocket),
);
