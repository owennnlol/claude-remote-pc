# claude-remote-pc (proof of concept)

Spins up a disposable Linux desktop inside a free GitHub Actions runner, lets
Claude Code operate it unattended, and streams the screen out live via a
Cloudflare quick tunnel.

This is step one only: proving the automation chain actually works before any
desktop app gets built around it. No app yet — you trigger it by hand and
watch the link.

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

## Running it

```
gh workflow run agent-run.yml -f task="whatever you want Claude to do"
```

Then:
```
gh run watch
```

Once the "Open public tunnel" step finishes, open the run's summary
(`gh run view --web`) for the live-view link, or just watch the log.

## Known risk in this scaffold — read before running

The agent step runs with `--dangerously-skip-permissions`, which turns off
Claude Code's normal per-action confirmation prompts so it can act without a
human clicking "approve" at each step. That's only acceptable because this
machine is thrown away the moment the job ends and has no access to anything
of yours beyond this repo checkout. Never use that flag on a persistent
machine or one with real credentials/files on it.

## What this doesn't do yet

- No desktop app — this is CLI-only, triggered by hand.
- No auth beyond the raw GitHub secret — no GitHub App, no scoped install.
- The tunnel link has no password; anyone with it can watch the run live.
- Only tested with Claude. OpenAI/Gemini paths not built.
