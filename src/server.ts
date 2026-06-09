import { readFile } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { join, extname, resolve } from 'node:path'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { getGitDiff, getCustomGitDiff, getRepoName, getBranchName, getFileContent, isImageFile, getTabSizeForFiles, getUntrackedFilePaths } from './git.js'
import { loadSettings, saveSettings } from './settings.js'
import { InMemoryCommentStore } from './comments.js'
import type { CommentStore } from './comments.js'
import { isSafePath } from './path.js'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

export interface BinaryFileInfo {
  path: string
  type: 'added' | 'deleted' | 'changed' | 'untracked'
}

function parseFilePaths(patch: string): string[] {
  const paths = new Set<string>()
  for (const line of patch.split('\n')) {
    const match = line.match(/^diff --git a\/.+ b\/(.+)$/)
    if (match) paths.add(match[1])
  }
  return [...paths]
}

function parseBinaryFiles(patch: string, untrackedFiles?: Set<string>): BinaryFileInfo[] {
  const binaryFiles: BinaryFileInfo[] = []
  const lines = patch.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.startsWith('Binary files ') || !line.includes(' differ')) continue

    // Find the file path from the preceding diff --git line
    let filePath = ''
    for (let j = i - 1; j >= 0; j--) {
      const match = lines[j].match(/^diff --git a\/.+ b\/(.+)$/)
      if (match) {
        filePath = match[1]
        break
      }
    }
    if (!filePath) continue

    // Determine change type from surrounding lines
    let changeType: BinaryFileInfo['type'] = 'changed'
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].startsWith('diff --git')) break
      if (lines[j].startsWith('new file mode')) {
        changeType = 'added'
        break
      }
      if (lines[j].startsWith('deleted file mode')) {
        changeType = 'deleted'
        break
      }
    }

    if (changeType === 'added' && untrackedFiles?.has(filePath)) {
      changeType = 'untracked'
    }
    binaryFiles.push({ path: filePath, type: changeType })
  }
  return binaryFiles
}

export function createApp(clientDir: string, customDiffArgs?: string[], commentStore?: CommentStore, tabShutdown = false) {
  const app = new Hono()

  app.onError((err, c) => {
    console.error('[diffx] request error:', err)
    return c.text('Internal Server Error', 500)
  })
  const isCustomMode = !!customDiffArgs
  const store = commentStore ?? new InMemoryCommentStore()
  const viewedFiles = new Map<string, string>()

  // --- Live reload: watch the working tree and notify connected clients ---
  // Subscribers are SSE writer callbacks. The recursive fs.watch is created
  // lazily on the first connection and torn down when the last client leaves,
  // so there is zero watch overhead when nobody is reviewing.
  const sseClients = new Set<(event: string) => void>()
  let watcher: FSWatcher | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // The current open review comments. Delivered to a backgrounded agent through
  // the /api/wait-finish long-poll (below) — both the "Send to agent" button and
  // tab-close go through this single channel; there is no stdout emit.
  const getOpenComments = async () => (await store.getAll()).filter((cm) => cm.status === 'open')

  // Long-poll waiters for /api/wait-finish. A finish event resolves all of them,
  // pushing the open comments to whoever holds the request — a real notification
  // without the server exiting.
  //   'finish' → the reviewer clicked "Send to agent"; the server stays up.
  //   'closed' → the review tab was closed; this is the final round.
  type FinishEvent = { event: 'finish' | 'closed'; comments: Awaited<ReturnType<typeof getOpenComments>> }
  const finishWaiters = new Set<(e: FinishEvent) => void>()
  const triggerFinish = (e: FinishEvent) => {
    for (const w of finishWaiters) w(e)
    finishWaiters.clear()
  }

  // --- Tab-bound shutdown (--tab-shutdown) ---
  // Closing the review tab should tear the server down so a backgrounded
  // process doesn't orphan. A clean tab-close ends the SSE stream (onAbort),
  // but over a LAN a lid-close or Wi-Fi drop leaves a half-open socket with no
  // FIN — onAbort never fires, the server lingers, and its in-memory comments
  // are lost. So a departed reviewer is detected three ways, all funneling
  // through one closeReview() that flushes open comments before exit:
  //   1. onAbort   — clean SSE close (fast, best-effort; the original path).
  //   2. beacon    — navigator.sendBeacon('/api/finish?closed=1') on pagehide.
  //   3. heartbeat — UI POSTs /api/heartbeat every 5s; we exit if none for >12s.
  let everConnected = false // don't exit before the UI ever opens (agent-only polling keeps us alive)
  let closing = false // idempotent — the three triggers can race
  let lastHeartbeat = 0
  // If the tab closes while no wait-finish poll is held (agent between rounds),
  // the comments are stashed here so the next poll returns them immediately.
  let stashedClosed: FinishEvent | null = null

  const closeReview = async () => {
    if (!tabShutdown || closing) return
    closing = true
    const comments = await getOpenComments()
    if (finishWaiters.size > 0) {
      // An agent is holding a wait-finish poll: deliver now, give the response
      // a beat to flush, then exit.
      triggerFinish({ event: 'closed', comments })
      setTimeout(() => process.exit(0), 250)
    } else {
      // No poll held. Stash the comments so the next wait-finish hands them
      // over, and exit after a grace long enough for the agent to come back.
      stashedClosed = { event: 'closed', comments }
      setTimeout(() => process.exit(0), 10_000)
    }
  }

  // Heartbeat monitor: once a reviewer has been seen, reap the server if the
  // beats stop (a half-open socket that onAbort never noticed).
  if (tabShutdown) {
    const HEARTBEAT_TIMEOUT_MS = 12_000
    const timer = setInterval(() => {
      if (closing || !everConnected || !lastHeartbeat) return
      if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT_MS) void closeReview()
    }, 3_000)
    timer.unref?.()
  }

  const broadcast = (event: string) => {
    for (const send of sseClients) send(event)
  }

  const isNoise = (filename: string) =>
    filename.startsWith('.git') ||
    filename.includes('node_modules') ||
    filename.startsWith('dist')

  const ensureWatcher = () => {
    if (watcher) return
    try {
      watcher = watch(process.cwd(), { recursive: true }, (_event, filename) => {
        if (!filename) return
        const name = filename.toString().replaceAll('\\', '/')
        if (isNoise(name)) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => broadcast('diff-changed'), 300)
      })
    } catch {
      // Recursive watch unsupported on this platform — live reload is a
      // progressive enhancement, so degrade silently.
      watcher = null
    }
  }

  const maybeStopWatcher = () => {
    if (sseClients.size === 0 && watcher) {
      watcher.close()
      watcher = null
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      const send = (event: string) => {
        void stream.writeSSE({ event, data: event })
      }
      sseClients.add(send)
      everConnected = true // a reviewer's UI has opened
      ensureWatcher()

      stream.onAbort(() => {
        sseClients.delete(send)
        maybeStopWatcher()
        if (sseClients.size === 0) void closeReview() // last tab closed → final finish + exit
      })

      // Hold the connection open with periodic keep-alive comments. A 10s ping
      // (paired with TCP keepalive on the socket) makes a dead LAN peer surface
      // sooner — a failed write trips onAbort instead of lingering for minutes.
      while (!stream.closed && !stream.aborted) {
        await stream.sleep(10000)
        await stream.writeSSE({ event: 'ping', data: 'ping' })
      }
    })
  })

  app.get('/api/diff', (c) => {
    let patch: string
    const staged = c.req.query('staged') === 'true'
    const untracked = c.req.query('untracked') === 'true'
    if (isCustomMode) {
      patch = getCustomGitDiff(customDiffArgs)
    } else {
      patch = getGitDiff({ staged, untracked })
    }
    const repoName = getRepoName()
    const branch = getBranchName()
    const untrackedFiles = untracked ? getUntrackedFilePaths() : []
    const untrackedSet = new Set(untrackedFiles)
    const binaryFiles = parseBinaryFiles(patch, untrackedSet)
    const filePaths = parseFilePaths(patch)
    const tabSizeMap = getTabSizeForFiles(filePaths)
    const diffArgs = isCustomMode ? (customDiffArgs ?? []) : []
    return c.json({ patch, repoName, branch, customMode: isCustomMode, diffArgs, binaryFiles, tabSizeMap, untrackedFiles })
  })

  app.get('/api/file-content', (c) => {
    const path = c.req.query('path')
    const version = c.req.query('version') as 'old' | 'new'
    if (!path || !version) {
      return c.json({ error: 'Missing path or version' }, 400)
    }
    const content = getFileContent(path, version)
    if (!content) {
      return c.json({ error: 'File not found' }, 404)
    }
    const ext = extname(path)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    return new Response(new Uint8Array(content), {
      headers: { 'Content-Type': contentType },
    })
  })

  app.get('/api/settings', (c) => {
    return c.json(loadSettings())
  })

  app.put('/api/settings', async (c) => {
    const body = await c.req.json()
    const settings = saveSettings(body)
    return c.json(settings)
  })

  app.get('/api/viewed', (c) => {
    return c.json(Object.fromEntries(viewedFiles))
  })

  app.put('/api/viewed', async (c) => {
    const { filePath, viewed, contentHash } = await c.req.json<{ filePath: string; viewed: boolean; contentHash?: string }>()
    if (viewed) {
      if (typeof contentHash !== 'string' || contentHash.length === 0) {
        return c.json({ error: 'non-empty contentHash required when marking viewed' }, 400)
      }
      viewedFiles.set(filePath, contentHash)
    } else {
      viewedFiles.delete(filePath)
    }
    return c.json({ ok: true })
  })

  // "Send to agent" (finish-without-exiting): push the current open comments to
  // any waiting /api/wait-finish poll and keep the server running, so the agent
  // applies them and replies/resolves via the live API while the reviewer keeps
  // iterating. Complements --tab-shutdown rather than replacing it.
  app.post('/api/finish', async (c) => {
    if (c.req.query('closed') === '1') {
      // Beacon from pagehide: the reviewer's tab is going away. Route through
      // closeReview so a half-open socket can't strand the final comments.
      await closeReview()
      return c.json({ ok: true })
    }
    const comments = await getOpenComments()
    triggerFinish({ event: 'finish', comments })
    return c.json({ count: comments.length })
  })

  // Reviewer liveness beat (see the --tab-shutdown notes above). Recording the
  // beat marks the UI as present; the monitor reaps the server when beats stop.
  app.post('/api/heartbeat', (c) => {
    everConnected = true
    lastHeartbeat = Date.now()
    return c.json({ ok: true })
  })

  // Long-poll: a backgrounded agent holds this request open and is notified the
  // instant a finish event fires — the "Send to agent" button (event 'finish',
  // server stays up) or tab-close (event 'closed', the final round) — receiving
  // the open comments in the response. No polling, no stdout, no exit required
  // for the iterative path.
  app.get('/api/wait-finish', async (c) => {
    // A tab-close that found no poll held stashed its comments here; hand them
    // over right away and let the (already-scheduled) exit wind down sooner.
    if (stashedClosed) {
      const stashed = stashedClosed
      stashedClosed = null
      if (closing) setTimeout(() => process.exit(0), 250)
      return c.json(stashed)
    }
    const result = await new Promise<FinishEvent | { event: 'aborted'; comments: [] }>((resolve) => {
      const waiter = (e: FinishEvent) => resolve(e)
      finishWaiters.add(waiter)
      c.req.raw.signal.addEventListener('abort', () => {
        finishWaiters.delete(waiter)
        resolve({ event: 'aborted', comments: [] })
      })
    })
    return c.json(result)
  })

  app.get('/api/comments', async (c) => {
    // Optional ?status=open|resolved filter. Coding agents fetch
    // ?status=open so they only act on unresolved threads; the UI omits it
    // to show resolved threads too (collapsed).
    const status = c.req.query('status')
    const comments = await store.getAll()
    const result = status ? comments.filter((cm) => cm.status === status) : comments
    return c.json(result)
  })

  app.post('/api/comments', async (c) => {
    const body = await c.req.json()
    const comment = {
      id: crypto.randomUUID(),
      filePath: body.filePath,
      side: body.side,
      lineNumber: body.lineNumber,
      lineContent: body.lineContent,
      body: body.body,
      status: 'open' as const,
      createdAt: Date.now(),
      replies: [],
    }
    const created = await store.add(comment)
    return c.json(created, 201)
  })

  app.put('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const { body, status } = await c.req.json()
    const updated = await store.update(id, { body, status })
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.post('/api/comments/:id/replies', async (c) => {
    const commentId = c.req.param('id')
    const { body, author } = await c.req.json()
    const reply = {
      id: crypto.randomUUID(),
      body,
      author: author === 'user' ? ('user' as const) : ('agent' as const),
      createdAt: Date.now(),
    }
    const updated = await store.addReply(commentId, reply)
    if (!updated) return c.json({ error: 'Comment not found' }, 404)
    return c.json(updated)
  })

  app.delete('/api/comments/:id', async (c) => {
    const id = c.req.param('id')
    const removed = await store.remove(id)
    if (!removed) return c.json({ error: 'Comment not found' }, 404)
    return c.json({ ok: true })
  })

  app.get('/*', async (c) => {
    let filePath = c.req.path
    if (filePath === '/') filePath = '/index.html'

    const relativePath = filePath.slice(1)
    if (!isSafePath(relativePath, clientDir)) {
      return c.text('Forbidden', 403)
    }
    const fullPath = resolve(clientDir, relativePath)
    try {
      const content = await readFile(fullPath)
      const ext = extname(fullPath)
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'
      return new Response(content, {
        headers: { 'Content-Type': contentType },
      })
    } catch {
      const indexContent = await readFile(join(clientDir, 'index.html'))
      return new Response(indexContent, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
  })

  return app
}

export function startServer(options: {
  port: number
  host: string
  clientDir: string
  customDiffArgs?: string[]
  tabShutdown?: boolean
}): Promise<{ port: number }> {
  const app = createApp(options.clientDir, options.customDiffArgs, undefined, options.tabShutdown)

  return new Promise((resolve) => {
    const server = serve({
      fetch: app.fetch,
      port: options.port,
      hostname: options.host,
    }, (info) => {
      resolve({ port: info.port })
    })
    // Enable TCP keepalive so a dropped LAN peer (lid close / Wi-Fi drop, no
    // FIN) surfaces as a dead socket in seconds rather than the OS default of
    // many minutes — the kernel-level half of the heartbeat/ping detection.
    ;(server as unknown as import('node:net').Server).on('connection', (socket) => {
      socket.setKeepAlive(true, 10_000)
    })
  })
}
