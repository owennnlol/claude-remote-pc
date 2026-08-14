# claude-remote-pc (proof of concept)

Spins up a disposable Linux desktop inside a free GitHub Actions runner,
lets Claude Code operate it unattended, and streams the screen out live via
a Cloudflare quick tunnel. The session stays alive and accepts new prompts
until you explicitly stop it (or 6 hours pass, GitHub's hard cap) — it does
not tear down after a single task.

This is step one only: proving the automation chain actually works before
any desktop app gets built around it. No app yet — you trigger and drive it
by hand.

## One-time setup

1. Generate a Claude Code OAuth token from your own subscription (Pro/Max):
   ```
   claude setup-token
   ```
   Copy the token it prints.

2. Add it as a repo secret:
   ```
   gh secret set CLAUDE_CODE_OAUTH_TOKEN
   ```
   (paste the token when prompted)

3. Pick a password for the live view and add it as a secret (this repo is
   public, so the tunnel link itself isn't a secret — the password is what
   actually keeps randoms from taking control of the desktop):
   ```
   gh secret set VNC_PASSWORD
   ```
   Only the first 8 characters matter (a limit of the VNC auth protocol
   itself), so keep it short.

4. Pick a control token — this one guards the channel that tells Claude
   what to do, so make it a real random value, not a short password:
   ```
   gh secret set CONTROL_TOKEN
   ```
   (e.g. generate one with `openssl rand -hex 16`)

## Running it

Start a session (no task needed up front — everything goes through the
control channel now):
```
gh workflow run agent-run.yml
gh run watch
```

Once the "Open public tunnels" step finishes, check its log for two lines:
```
>>> WATCH: https://xxxx.trycloudflare.com/vnc.html?... <<<
>>> CONTROL: https://yyyy.trycloudflare.com <<<
```
```
gh run view --job=<job-id> --log | grep ">>>"
```

Open the WATCH link in a browser (enter `VNC_PASSWORD` when prompted) to
see the desktop live. Send it tasks via the CONTROL link:
```
curl -X POST https://yyyy.trycloudflare.com/prompt \
  -H "Authorization: Bearer <CONTROL_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"task": "whatever you want Claude to do"}'
```
Each call waits for Claude to finish that task and returns its output.
Send as many as you want, in sequence — later prompts continue the same
conversation. When you're done:
```
curl -X POST https://yyyy.trycloudflare.com/stop \
  -H "Authorization: Bearer <CONTROL_TOKEN>"
```
which commits/pushes anything pending and ends the job. If you forget, an
idle timeout (20 minutes with no requests) shuts it down automatically.

## Known risk in this scaffold — read before running

The agent runs with `--dangerously-skip-permissions`, which turns off
Claude Code's normal per-action confirmation prompts so it can act without
a human clicking "approve" at each step. That's only acceptable because
this machine is thrown away when the session ends and has no access to
anything of yours beyond this repo checkout. Never use that flag on a
persistent machine or one with real credentials/files on it.

Because the session now lives much longer than before (potentially the
full 6 hours), the VNC and control tunnels are exposed for far longer too.
Both are password/token gated, but neither has rate limiting or brute-force
protection — don't treat this as production-grade auth.

## What this doesn't do yet

- No desktop app — this is CLI/curl-driven, triggered by hand.
- No auth beyond raw GitHub secrets — no GitHub App, no scoped install.
- No streaming output — `/prompt` blocks until each task finishes rather
  than showing progress live.
- Only tested with Claude. OpenAI/Gemini paths not built.
