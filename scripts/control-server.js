const http = require('http');
const { spawnSync } = require('child_process');

const TOKEN = process.env.CONTROL_TOKEN;
const PORT = 7777;
const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
const TASK_TIMEOUT_MS = 10 * 60 * 1000;

let started = false;
let lastActivity = Date.now();

function authed(req) {
  return req.headers['authorization'] === `Bearer ${TOKEN}`;
}

function commitAndPush() {
  spawnSync('git', ['add', '-A']);
  const diff = spawnSync('git', ['diff', '--cached', '--quiet']);
  if (diff.status !== 0) {
    spawnSync('git', ['commit', '-m', 'Agent session output']);
    spawnSync('git', ['push']);
  }
}

function shutdown() {
  commitAndPush();
  process.exit(0);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  if (!authed(req)) {
    res.writeHead(401);
    res.end('unauthorized');
    return;
  }
  lastActivity = Date.now();

  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ready', started }));
    return;
  }

  if (req.method === 'POST' && req.url === '/prompt') {
    const body = await readBody(req);
    let task;
    try {
      task = JSON.parse(body).task;
    } catch {
      res.writeHead(400);
      res.end('bad json');
      return;
    }

    const args = started
      ? ['-c', '-p', '--dangerously-skip-permissions', task]
      : ['-p', '--dangerously-skip-permissions', task];
    started = true;

    const result = spawnSync('claude', args, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: TASK_TIMEOUT_MS,
      env: process.env,
    });
    commitAndPush();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        timedOut: result.error && result.error.code === 'ETIMEDOUT',
      })
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/stop') {
    res.writeHead(200);
    res.end('stopping');
    setTimeout(shutdown, 300);
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

setInterval(() => {
  if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
    console.log('idle timeout reached, shutting down');
    shutdown();
  }
}, 30 * 1000);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`control server listening on ${PORT}`);
});
