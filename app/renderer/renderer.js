window.addEventListener('error', (e) => {
  console.error('Uncaught error:', e.error || e.message);
});

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnSettings = document.getElementById('btn-settings');
const screenPlaceholder = document.getElementById('screen-placeholder');
const screenView = document.getElementById('screen-view');
const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
const btnSend = document.getElementById('btn-send');

const overlay = document.getElementById('settings-overlay');
const inputRepo = document.getElementById('input-repo');
const inputToken = document.getElementById('input-token');
const inputVnc = document.getElementById('input-vnc');
const ghStatusEl = document.getElementById('gh-status');
const btnSettingsSave = document.getElementById('btn-settings-save');
const btnSettingsCancel = document.getElementById('btn-settings-cancel');

let config = null;
let session = null; // { watch_url, control_url }

screenView.addEventListener('did-fail-load', (e) => {
  if (e.errorCode === -3) return; // ERR_ABORTED, fires on normal navigations away from about:blank
  addMessage('system', `Live view failed to load (${e.errorCode}: ${e.errorDescription}). The tunnel may still be starting — it can take a few seconds after the session comes up.`);
});

screenView.addEventListener('did-finish-load', () => {
  addMessage('system', 'Live view connected.');
});

screenView.addEventListener('crashed', () => {
  addMessage('system', 'Live view crashed. Try Stop PC and Start PC again.');
});

marked.setOptions({ breaks: true });

function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text));
}

function setStatus(state, text) {
  statusDot.className = 'dot ' + (state || '');
  statusText.textContent = text;
}

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = 'msg msg-' + role;
  if (role === 'claude') {
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function openSettings() {
  inputRepo.value = config?.repo || '';
  inputToken.value = config?.controlToken || '';
  inputVnc.value = config?.vncPassword || '';
  ghStatusEl.textContent = 'Checking for GitHub CLI...';
  overlay.hidden = false;
  window.api.checkGh().then((res) => {
    ghStatusEl.textContent = res.ok
      ? `GitHub CLI found (${res.path}), and it must already be logged in (gh auth login).`
      : `${res.error}`;
  });
}

function closeSettings() {
  overlay.hidden = true;
}

btnSettings.addEventListener('click', openSettings);
btnSettingsCancel.addEventListener('click', closeSettings);

btnSettingsSave.addEventListener('click', async () => {
  console.log('[save] click fired');
  ghStatusEl.textContent = 'Saving...';
  try {
    const next = {
      repo: inputRepo.value.trim(),
      controlToken: inputToken.value.trim(),
      vncPassword: inputVnc.value.trim(),
    };
    console.log('[save] window.api present:', !!window.api);
    if (!window.api) throw new Error('window.api is undefined — preload script did not load');
    console.log('[save] invoking saveConfig...');
    await window.api.saveConfig(next);
    console.log('[save] saveConfig resolved');
    config = next;
    closeSettings();
    setStatus('', config.repo ? 'Ready' : 'Not configured');
    btnStart.disabled = !config.repo || !config.controlToken;
  } catch (err) {
    ghStatusEl.textContent = `Error saving: ${err.message}`;
    console.error(err);
  }
});

btnStart.addEventListener('click', async () => {
  if (!config?.repo) {
    openSettings();
    return;
  }
  btnStart.disabled = true;
  setStatus('starting', 'Starting session...');
  addMessage('system', 'Dispatching workflow and waiting for the session to come up (this can take ~1-2 minutes)...');

  try {
    session = await window.api.startSession(config.repo);
    setStatus('running', 'Session running');
    btnStart.hidden = true;
    btnStop.hidden = false;

    screenPlaceholder.hidden = true;
    screenView.src = session.watch_url;
    screenView.hidden = false;

    chatInput.disabled = false;
    btnSend.disabled = false;
    addMessage('system', 'Session is live. Enter the VNC password in the view on the left, then start prompting Claude on the right.');
  } catch (err) {
    setStatus('error', 'Failed to start');
    addMessage('system', `Failed to start: ${err.message}`);
    btnStart.disabled = false;
  }
});

btnStop.addEventListener('click', async () => {
  if (!session) return;
  btnStop.disabled = true;
  setStatus('starting', 'Stopping...');
  try {
    await window.api.stopSession(session.control_url, config.controlToken);
  } catch (err) {
    addMessage('system', `Stop request failed: ${err.message}`);
  }
  resetToIdle();
});

function resetToIdle() {
  session = null;
  setStatus('', 'Ready');
  btnStart.hidden = false;
  btnStart.disabled = false;
  btnStop.hidden = true;
  btnStop.disabled = false;
  chatInput.disabled = true;
  btnSend.disabled = true;
  screenView.hidden = true;
  screenView.src = 'about:blank';
  screenPlaceholder.hidden = false;
  addMessage('system', 'Session ended.');
}

async function sendCurrentPrompt() {
  const task = chatInput.value.trim();
  if (!task || !session) return;
  chatInput.value = '';
  addMessage('user', task);
  btnSend.disabled = true;
  chatInput.disabled = true;
  const pending = addMessage('claude', 'Working...');

  try {
    const result = await window.api.sendPrompt(session.control_url, config.controlToken, task);
    let text = result.stdout?.trim() || result.stderr?.trim() || '(no output)';
    if (result.timedOut) {
      text += '\n\n(task timed out after 10 minutes)';
    }
    pending.innerHTML = renderMarkdown(text);
  } catch (err) {
    pending.textContent = `Error: ${err.message}`;
  }

  btnSend.disabled = false;
  chatInput.disabled = false;
  chatInput.focus();
}

btnSend.addEventListener('click', sendCurrentPrompt);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendCurrentPrompt();
  }
});

(async function init() {
  config = await window.api.getConfig();
  if (!config?.repo || !config?.controlToken) {
    setStatus('', 'Not configured');
    openSettings();
  } else {
    setStatus('', 'Ready');
    btnStart.disabled = false;
  }
})();
