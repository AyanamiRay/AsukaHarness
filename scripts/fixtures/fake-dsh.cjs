// Minimal stand-in for `dsh web`, used only by the smoke check.
// It prints the same banner shape as the real CLI and serves a tiny page.
const http = require('node:http');

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const host = readFlag('--host', '127.0.0.1');
const port = Number(readFlag('--port', '3080'));

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fake DSH</title>
<style>html,body{margin:0;height:100%}#root{height:100%}
.app{height:100%;background:#161a22;color:#e8eaf0;font:14px system-ui;padding:24px}</style></head>
<body><div id="root"><div class="app">FAKE DSH — smoke fixture</div></div></body></html>`;

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page);
});

server.listen(port, host, () => {
  console.log(`fake dsh ready on ${host}:${port}`);
  console.log(`dsh web: http://${host}:${port}/?token=smoke-token-123456`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
