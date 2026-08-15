const http = require('http');
const { spawn, spawnSync } = require('child_process');
const readline = require('readline');

const TOKEN = process.env.CONTROL_TOKEN;
const PORT = 7777;
const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
const TASK_TIMEOUT_MS = 10 * 60 * 1000;

let lastActivity = Date.now();
let pendingResolve = null;
let pendingReject = null;
let pendingTimeout = null;

const claudeProc = spawn(
  'claude',
  [
    '--print',
    '--verbose',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
  ],
  { env: process.env }
);

const rl = readline.createInterface({ input: claudeProc.stdout });

rl.on('line', (line) => {
  let evt;
  try {
    evt = JSON.parse(line);
  } catch {
    return;
  }
  if (evt.type === 'result' && pendingResolve) {
    clearTimeout(pendingTimeout);
    const resolve = pendingResolve;
    pendingResolve = null;
    pendingReject = null;
    resolve({ text: evt.result || '', isError: !!evt.is_error });
  }
});

claudeProc.stderr.on('data', (d) => console.error('[claude stderr]', d.toString()));

claudeProc.on('exit', (code) => {
  console.error('claude process exited unexpectedly, code:', code);
  if (pendingReject) {
    pendingReject(new Error('claude process exited unexpectedly'));
  }
  process.exit(1);
});

function runPrompt(task) {
  return new Promise((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;
    pendingTimeout = setTimeout(() => {
      pendingResolve = null;
      pendingReject = null;
      reject(new Error('task timed out after 10 minutes'));
    }, TASK_TIMEOUT_MS);
    claudeProc.stdin.write(
      JSON.stringify({ type: 'user', message: { role: 'user', content: task } }) + '\n'
    );
  });
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
  claudeProc.kill();
  process.exit(0);
}

function authed(req) {
  return req.headers['authorization'] === `Bearer ${TOKEN}`;
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
    res.end(JSON.stringify({ status: 'ready', busy: !!pendingResolve }));
    return;
  }

  if (req.method === 'POST' && req.url === '/prompt') {
    if (pendingResolve) {
      res.writeHead(409);
      res.end('a task is already running, wait for it to finish');
      return;
    }
    const body = await readBody(req);
    let task;
    try {
      task = JSON.parse(body).task;
    } catch {
      res.writeHead(400);
      res.end('bad json');
      return;
    }

    try {
      const result = await runPrompt(task);
      commitAndPush();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stdout: result.text, stderr: '', timedOut: false }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stdout: '', stderr: err.message, timedOut: true }));
    }
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
