/**
 * Patches installed whatsapp-web.js 1.34.7 for WA Web builds where
 * window.require('WAWebSocketModel') is missing.
 *
 * Run against a clean install:
 *   npm install whatsapp-web.js@1.34.7 --no-save
 *   node scripts/patch-wwebjs-socket-compat.js
 *   npx patch-package whatsapp-web.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');
const authPath = path.join(root, 'src', 'util', 'Injected', 'AuthStore', 'AuthStore.js');
const clientPath = path.join(root, 'src', 'Client.js');

const AUTH_STORE = `'use strict';

/**
 * Resolve WhatsApp Web Socket / AppState across module renames.
 * Throws a tagged error when no compatible module is available.
 */
function resolveWaSocket() {
    const tryRequire = (moduleId) => {
        try {
            return window.require(moduleId);
        } catch (_error) {
            return undefined;
        }
    };

    const fromModule = (mod) => {
        if (!mod) {
            return undefined;
        }
        if (mod.Socket && typeof mod.Socket.on === 'function') {
            return mod.Socket;
        }
        if (mod.default && mod.default.Socket && typeof mod.default.Socket.on === 'function') {
            return mod.default.Socket;
        }
        if (typeof mod.on === 'function' && mod.state !== undefined) {
            return mod;
        }
        return undefined;
    };

    const directIds = [
        'WAWebSocketModel',
        'WAWebSocket',
        'WAWebSocketCollection',
        'SocketModel',
    ];

    for (const moduleId of directIds) {
        const socket = fromModule(tryRequire(moduleId));
        if (socket) {
            return { socket, moduleId, strategy: 'require' };
        }
    }

    const webpackRequire = window.require;
    const factories = webpackRequire && webpackRequire.m ? webpackRequire.m : null;
    if (factories && typeof factories === 'object') {
        for (const moduleId of Object.keys(factories)) {
            const mod = tryRequire(moduleId);
            const socket = fromModule(mod);
            if (
                socket &&
                socket.state !== undefined &&
                (socket.stream !== undefined || typeof socket.reconnect === 'function')
            ) {
                return { socket, moduleId: String(moduleId), strategy: 'webpack-scan' };
            }
        }
    }

    throw new Error(
        'WWEBJS_MODULE_COMPATIBILITY_ERROR: missing WAWebSocketModel (and no Socket fallback)',
    );
}

exports.ExposeAuthStore = () => {
    const resolved = resolveWaSocket();
    window.AuthStore = {};
    window.AuthStore.AppState = resolved.socket;
    window.AuthStore.__socketModuleId = resolved.moduleId;
    window.AuthStore.__socketStrategy = resolved.strategy;
    window.AuthStore.Cmd = window.require('WAWebCmd').Cmd;
    window.AuthStore.Conn = window.require('WAWebConnModel').Conn;
    window.AuthStore.OfflineMessageHandler = window.require(
        'WAWebOfflineHandler',
    ).OfflineMessageHandler;
    window.AuthStore.PairingCodeLinkUtils = window.require(
        'WAWebAltDeviceLinkingApi',
    );
    window.AuthStore.Base64Tools = window.require('WABase64');
    window.AuthStore.RegistrationUtils = {
        ...window.require('WAWebCompanionRegClientUtils'),
        ...window.require('WAWebAdvSignatureApi'),
        ...window.require('WAWebUserPrefsInfoStore'),
        ...window.require('WAWebSignalStoreApi'),
    };
};
`;

const SOCKET_EXPR =
  "((window.AuthStore && window.AuthStore.AppState) || window.require('WAWebSocketModel').Socket)";
const STATE_TOKEN = '__PATROL_WA_SOCKET_STATE__';
const SOCKET_TOKEN = '__PATROL_WA_SOCKET__';

fs.writeFileSync(authPath, AUTH_STORE, 'utf8');

let client = fs.readFileSync(clientPath, 'utf8');

// Collapse any previous nested patch attempts back to stock require forms.
for (let pass = 0; pass < 5; pass += 1) {
  const before = client;
  client = client.replace(
    /\(\(+window\.AuthStore && window\.AuthStore\.AppState\)+\s*\|\|\s*\(+window\.AuthStore && window\.AuthStore\.AppState\)+\s*\|\|\s*window\.require\('WAWebSocketModel'\)\.Socket\)+\)+\.state/g,
    "window.require('WAWebSocketModel').Socket.state",
  );
  client = client.replace(
    /\(\(window\.AuthStore && window\.AuthStore\.AppState\) \|\| window\.require\('WAWebSocketModel'\)\.Socket\)\.state/g,
    "window.require('WAWebSocketModel').Socket.state",
  );
  client = client.replace(
    /\(\(window\.AuthStore && window\.AuthStore\.AppState\) \|\| window\.require\('WAWebSocketModel'\)\.Socket\)/g,
    "window.require('WAWebSocketModel').Socket",
  );
  client = client.replace(
    /\(window\.AuthStore && window\.AuthStore\.AppState\) \|\| window\.require\('WAWebSocketModel'\)\.Socket\.state/g,
    "window.require('WAWebSocketModel').Socket.state",
  );
  client = client.replace(
    /\(window\.AuthStore && window\.AuthStore\.AppState\) \|\| window\.require\('WAWebSocketModel'\)\.Socket/g,
    "window.require('WAWebSocketModel').Socket",
  );
  client = client.replace(/window\.AuthStore\.AppState/g, "window.require('WAWebSocketModel').Socket");
  if (client === before) {
    break;
  }
}

const stateCount = client.split("window.require('WAWebSocketModel').Socket.state").length - 1;
client = client.split("window.require('WAWebSocketModel').Socket.state").join(STATE_TOKEN);

const socketCount = client.split("window.require('WAWebSocketModel').Socket").length - 1;
client = client.split("window.require('WAWebSocketModel').Socket").join(SOCKET_TOKEN);

client = client.split(STATE_TOKEN).join(`${SOCKET_EXPR}.state`);
client = client.split(SOCKET_TOKEN).join(SOCKET_EXPR);

client = client.replace(
  /window\s*\n\s*\.require\('WAWebSocketModel'\)\s*\n\s*\.Socket/g,
  'window.AuthStore.AppState',
);

fs.writeFileSync(clientPath, client, 'utf8');

console.log(
  JSON.stringify(
    {
      stateCount,
      socketCount,
      goodStateCount: client.split(`${SOCKET_EXPR}.state`).length - 1,
      nestedBad: client.includes('|| ((window.AuthStore'),
      remainingModuleRefs: (client.match(/WAWebSocketModel/g) || []).length,
    },
    null,
    2,
  ),
);
