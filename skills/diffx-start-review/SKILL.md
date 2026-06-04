---
name: diffx-start-review
description: "Start a code review session by launching the diffx server for LAN access (0.0.0.0, pinned port 3433). Use when the user invokes /diffx-start-review."
user_invocable: true
---

# Start diffx Review (LAN serving mode)

Launch the diffx server so the changes can be reviewed from another machine on the LAN, with inline comments.

> Fork-only customization (LAN host `0.0.0.0`, pinned port 3433, `--tab-shutdown`). Not for an upstream PR.

## What to do

### 1. Free port 3433 first

diffx falls back to a *random* port if 3433 is busy (so a leftover server/open tab would silently move the URL off 3433 and away from the firewall rule). Kill anything still on 3433 before launching — no-op if nothing's there:

```bash
powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -LocalPort 3433 -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }"
```

### 2. Launch diffx (scoped to the change under review)

**Scope the diff to what you just changed** — pass the git range that covers the change under review as
`-- <range>`. Do NOT default to the whole working tree; review "all changes" only when that genuinely is the
scope. Pick the range from context:
- the change is committed on a feature branch → `-- main..HEAD` (or `-- <base-branch>..HEAD`) — the typical case
- the last N commits → `-- HEAD~N`
- only staged changes → `-- --staged`
- uncommitted work-in-progress and that *is* the change → omit `--` (bare `diffx`, the working tree)

Run it backgrounded, bound to the LAN on the pinned port, self-terminating:

```bash
diffx --host 0.0.0.0 -p 3433 --no-open --tab-shutdown -- main..HEAD     # typical: feature branch vs main
```

Everything after `--` is passed to `git diff`; keep the `--host 0.0.0.0 -p 3433 --no-open --tab-shutdown`
prefix on whichever range you choose.

- **`--tab-shutdown`** makes the server **emit the open comments and then exit when the reviewer closes the tab** (and exit after a startup grace if the UI is never opened). This is how the comments come back to you (step 4), and it means there is **no orphan to tear down** — a backgrounded diffx would otherwise survive the task being stopped.
- **Pinned to port 3433** so the firewall rule is stable.
- `--no-open` because the reviewer connects over the LAN, not on this machine.
- **Firewall (prerequisite, already configured):** an inbound rule must allow TCP 3433. If missing, add it (PowerShell, admin):
  `New-NetFirewallRule -DisplayName diffx-lan -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3433 -Profile Any`

**Important:** Run diffx with the Bash tool `run_in_background: true` so the server stays alive while the user reviews; `--tab-shutdown` ends it when they're done.

### 3. Tell the user

Get this host's LAN IPv4 (PowerShell: `Get-NetIPAddress -AddressFamily IPv4 | ? { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' }`), then tell the user the URL using that IP:

> diffx is running for LAN review at **http://<LAN-IP>:3433** (substitute the IPv4 from above). Leave inline comments, then **close the tab when you're done** — your comments come straight back to me and I'll apply them. (Reachable by anyone on the LAN while the tab is open.)

Keep it brief.

### 4. Apply the comments when the tab closes

Closing the tab is the "done" signal: the server emits the open comments and exits, **completing the background task you launched in step 2**. When you get that completion notification, read the task's output, take the JSON array between `<<<DIFFX_COMMENTS_JSON>>>` and `<<<END_DIFFX_COMMENTS>>>`, and process each comment (fields: `filePath`, `side` = `additions`/`deletions`, `lineNumber`, `lineContent`, `body`):
- **change request** ("rename x to count", "extract this helper") → read `filePath`, locate the code via `lineContent`, make the edit.
- **question** ("why not a Map here?") → answer it in your summary; don't change code.

The server is already gone (no API to reply/resolve against), so just **apply the changes and give the user a brief summary** — how many edits you made and any questions you answered. Empty array → tell them there were no comments. A comment can still send the work back to an earlier phase (new ADR / fix), same as any review finding.
