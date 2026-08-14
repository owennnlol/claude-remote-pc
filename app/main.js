const { app, BrowserWindow, ipcMain } = require('electron');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execFileAsync = promisify(execFile);

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

let ghPathCache = null;

async function resolveGh() {
  if (ghPathCache) return ghPathCache;

  const candidates = ['gh'];
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\GitHub CLI\\gh.exe');
  } else {
    candidates.push('/usr/local/bin/gh', '/opt/homebrew/bin/gh', '/usr/bin/gh');
  }

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['--version']);
      ghPathCache = candidate;
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    'GitHub CLI (gh) not found. Install it from https://cli.github.com and run "gh auth login".'
  );
}

async function ghJson(args) {
  const gh = await resolveGh();
  const { stdout } = await execFileAsync(gh, args, { maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function fetchSessionFile(repo) {
  const gh = await resolveGh();
  const { stdout } = await execFileAsync(gh, ['api', `repos/${repo}/contents/session.json`]);
  const data = JSON.parse(stdout);
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return JSON.parse(content);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

ipcMain.handle('get-config', () => loadConfig());

ipcMain.handle('save-config', (_event, config) => {
  console.log('[main] save-config received for repo:', config.repo);
  saveConfig(config);
  console.log('[main] save-config wrote file to', CONFIG_PATH);
  return true;
});

ipcMain.handle('check-gh', async () => {
  try {
    const gh = await resolveGh();
    return { ok: true, path: gh };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('start-session', async (_event, { repo }) => {
  const gh = await resolveGh();
  const since = new Date();

  await execFileAsync(gh, ['workflow', 'run', 'agent-run.yml', '--repo', repo]);

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const session = await fetchSessionFile(repo);
      if (new Date(session.started_at) > since) {
        return session;
      }
    } catch {
      // session.json not there yet, or a stale one from before this run
    }
    await sleep(4000);
  }
  throw new Error('Timed out waiting for the session to start (5 min).');
});

ipcMain.handle('send-prompt', async (_event, { controlUrl, controlToken, task }) => {
  const res = await fetch(`${controlUrl}/prompt`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${controlToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ task }),
  });
  if (!res.ok) {
    throw new Error(`Control server returned ${res.status}`);
  }
  return res.json();
});

ipcMain.handle('stop-session', async (_event, { controlUrl, controlToken }) => {
  const res = await fetch(`${controlUrl}/stop`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${controlToken}` },
  });
  return { ok: res.ok };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0e0e12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('Preload error at', preloadPath, error);
  });
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
