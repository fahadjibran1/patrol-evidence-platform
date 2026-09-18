const fs = require('fs');
const http = require('http');

const requestLogPath = process.argv[2];
if (!requestLogPath) throw new Error('Request-log path argument is required.');
fs.writeFileSync(requestLogPath, '');

function reply(request, response, tracked) {
  if (tracked) {
    fs.appendFileSync(requestLogPath, `${JSON.stringify({
      url: request.url,
      token: request.headers['x-patrolsafe-desktop-token'] || null,
    })}\n`);
  }
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (request.url === '/desktop/bootstrap/runtime-identity') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ identity: 'patrolsafe-desktop-backend', proof: 'invalid' }));
    return;
  }
  response.writeHead(tracked ? 404 : 200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(tracked
    ? { statusCode: 404, message: 'Cannot GET /desktop/bootstrap/status' }
    : { status: 'ok' }));
}

const servers = [4011, 4012, 4013, 4014].map((port, index) =>
  http.createServer((request, response) => reply(request, response, index === 0)).listen(port, '127.0.0.1'));

Promise.all(servers.map((server) => new Promise((resolve) => server.once('listening', resolve))))
  .then(() => console.log(`HOSTILE_FIXTURE_READY requestLog=${requestLogPath}`));

function stop() {
  let remaining = servers.length;
  for (const server of servers) server.close(() => {
    remaining -= 1;
    if (remaining === 0) process.exit(0);
  });
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
