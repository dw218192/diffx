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

### 2. Launch diffx (scoped to *this task's* change)

**Scope the diff to exactly what _this task_ changed — not the whole branch.** `main..HEAD` (or
`<base>..HEAD`) includes everything on the branch, which usually bundles earlier, already-reviewed, or
unrelated commits — rarely what you want. Work out the precise delta this piece of work produced and pass
it as `-- <range>`:
- you committed N commits in this task → `-- HEAD~N..HEAD` (just those), or `-- <first-new-commit>^..HEAD`
- uncommitted work-in-progress and that *is* the change → omit `--` (bare `diffx`, the working tree); `-- --staged` for staged-only
- only fall back to `-- main..HEAD` when the **entire branch** genuinely is the change under review

When unsure which commits are yours, check `git log` / what you created this session and review only those.

Run it backgrounded, bound to the LAN on the pinned port, self-terminating:

```bash
diffx --host 0.0.0.0 -p 3433 --no-open --tab-shutdown -- HEAD~2..HEAD    # e.g. the 2 commits this task added
```

Everything after `--` is passed to `git diff`; keep the `--host 0.0.0.0 -p 3433 --no-open --tab-shutdown`
prefix on whichever range you choose.

- **`--tab-shutdown`** exits the server when the reviewer closes the tab, so a backgrounded diffx leaves **no orphan**. Comments are delivered to you over the API (step 3), not via stdout.
- **Pinned to port 3433** so the firewall rule is stable. `--no-open` because the reviewer is on the LAN, not this host.
- **Firewall (prerequisite, already configured):** an inbound rule must allow TCP 3433. If missing (PowerShell, admin):
  `New-NetFirewallRule -DisplayName diffx-lan -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3433 -Profile Any`

Run diffx with the Bash tool `run_in_background: true`.

### 3. Arm the finish notification (a second background task)

Immediately launch a long-poll that **notifies you** the moment the reviewer sends a batch or closes the tab — also `run_in_background: true`:

```bash
curl -s http://localhost:3433/api/wait-finish
```

It blocks (no output) until a finish event, then completes with a JSON body — that completion is your push notification. Use `localhost` (you're on the same host as the server).

### 4. Tell the user

Get this host's LAN IPv4 (PowerShell: `Get-NetIPAddress -AddressFamily IPv4 | ? { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' }`), then tell the user the URL using that IP:

> diffx is running for LAN review at **http://<LAN-IP>:3433** (substitute the IPv4 from above). Leave inline comments. Click **"Send to agent"** to have me act on a batch while you keep reviewing, or just **close the tab when you're done** — either way your comments come straight to me. (Reachable by anyone on the LAN while the tab is open.)

Keep it brief.

### 5. Process each round when the wait-finish task completes

When the **wait-finish** background task finishes, read its output — a JSON object `{ "event": ..., "comments": [...] }`:

- **`"event": "finish"`** — the reviewer clicked **Send to agent**; the **server is still up**. Apply the comments, reply/resolve each over the live API (the reviewer sees it in real time), then **re-arm** by launching `curl -s http://localhost:3433/api/wait-finish` again (`run_in_background`) and keep going.
- **`"event": "closed"`** — the reviewer **closed the tab**; this is the **final** round and the server is exiting. Apply the comments and give a brief summary — do **not** call the API (it's gone) and do **not** re-arm.
- **`"event": "aborted"`** — the poll was cancelled (rare); re-arm if the review is still open.

Each comment has `filePath`, `side` (`additions`/`deletions`), `lineNumber`, `lineContent`, `body`:
- **change request** ("rename x to count", "extract this helper") → read `filePath`, locate the code via `lineContent`, make the edit.
- **question** ("why not a Map here?") → answer it; don't change code.

While the server is up (a `finish` round), respond on each comment so the reviewer sees it live:
- reply: `curl -s -X POST http://localhost:3433/api/comments/<id>/replies -H 'Content-Type: application/json' -d '{"body":"<your reply>","author":"agent"}'`
- resolve: `curl -s -X PUT http://localhost:3433/api/comments/<id> -H 'Content-Type: application/json' -d '{"status":"resolved"}'`

Empty `comments` → nothing to do this round. (At any time the server is up you can also just `GET http://localhost:3433/api/comments?status=open` if you need to re-fetch.) A comment can still send the work back to an earlier phase (new ADR / fix), same as any review finding.
