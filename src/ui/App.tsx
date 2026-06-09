import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { parsePatchFiles } from '@pierre/diffs'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { ReviewComment } from '../types'
import { useDiff } from './hooks/useDiff'
import { useComments } from './hooks/useComments'
import { useSettings } from './hooks/useSettings'
import { useViewed } from './hooks/useViewed'
import { useLiveReload } from './hooks/useLiveReload'
import { useReviewerPresence } from './hooks/useReviewerPresence'
import { Toolbar } from './components/Toolbar'
import { DiffViewer } from './components/DiffViewer'
import { FileTree } from './components/FileTree'
import { CommentTracker } from './components/CommentTracker'

export function App() {
  const { settings, loaded, updateSettings } = useSettings()
  const { patch, repoName, branch, customMode, diffArgs, binaryFiles, tabSizeMap, untrackedFiles, loading, error, refetch } = useDiff({
    staged: settings.staged,
    untracked: settings.untracked,
  })
  const { stale, reset: resetStale } = useLiveReload()
  useReviewerPresence()

  const handleReload = useCallback(() => {
    refetch()
    resetStale()
  }, [refetch, resetStale])

  // Send the current open comments to the agent (emitted to the server's stdout)
  // without closing the tab, so the review can iterate while the server stays up.
  const handleFinishReview = useCallback(async () => {
    const res = await fetch('/api/finish', { method: 'POST' })
    return res.json() as Promise<{ count: number }>
  }, [])
  const { comments, addComment, removeComment, resolveComment, unresolveComment, addReply, editComment, copyAllComments } =
    useComments()
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('diffx-sidebar-collapsed') === 'true'
    } catch {
      return false
    }
  })
  const diffViewerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem('diffx-sidebar-collapsed', String(sidebarCollapsed))
    } catch {}
  }, [sidebarCollapsed])

  // Descriptive tab title so multiple review sessions are distinguishable:
  // "Diffx Code Review: <repo> — <commit range | branch>".
  useEffect(() => {
    if (!repoName) return
    const range = customMode ? diffArgs.join(' ') : branch
    document.title = range
      ? `Diffx Code Review: ${repoName} — ${range}`
      : `Diffx Code Review: ${repoName}`
  }, [repoName, branch, customMode, diffArgs])

  const untrackedSet = useMemo(() => new Set(untrackedFiles), [untrackedFiles])

  const files = useMemo(() => {
    if (!patch) return []
    try {
      const parsed = parsePatchFiles(patch)
      const parsedFiles = parsed.flatMap((p) => p.files)

      // Add synthetic entries for binary files not already in parsed output
      const existingNames = new Set(parsedFiles.map((f) => f.name))
      for (const bf of binaryFiles) {
        if (!existingNames.has(bf.path)) {
          const syntheticFile: FileDiffMetadata = {
            name: bf.path,
            type: bf.type === 'added' || bf.type === 'untracked' ? 'new' : bf.type === 'deleted' ? 'deleted' : 'change',
            hunks: [],
            splitLineCount: 0,
            unifiedLineCount: 0,
            isPartial: true,
            deletionLines: [],
            additionLines: [],
          }
          parsedFiles.push(syntheticFile)
        }
      }

      return parsedFiles
    } catch {
      return []
    }
  }, [patch, binaryFiles])

  const { viewedFiles, setViewed } = useViewed(files)

  const diffStats = useMemo(() => {
    if (!patch) return { additions: 0, deletions: 0 }
    let additions = 0
    let deletions = 0
    for (const line of patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }
    return { additions, deletions }
  }, [patch])

  const binaryFileMap = useMemo(() => {
    const map = new Map<string, (typeof binaryFiles)[number]>()
    for (const bf of binaryFiles) {
      map.set(bf.path, bf)
    }
    return map
  }, [binaryFiles])

  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of comments) {
      counts[c.filePath] = (counts[c.filePath] ?? 0) + 1
    }
    return counts
  }, [comments])

  const fileAnnotationsMap = useMemo(() => {
    const map = new Map<string, { side: ReviewComment['side']; lineNumber: number; metadata: ReviewComment }[]>()
    for (const c of comments) {
      let list = map.get(c.filePath)
      if (!list) {
        list = []
        map.set(c.filePath, list)
      }
      list.push({
        side: c.side,
        lineNumber: c.lineNumber,
        metadata: c,
      })
    }
    return map
  }, [comments])

  const handleFileClick = useCallback((filePath: string) => {
    setActiveFile(filePath)
    // In single-file view only the active file is mounted, so there is
    // nothing to scroll to — switching the active file is the navigation.
    if (settings.fileView === 'single') return
    const el = document.getElementById(`file-${filePath}`)
    if (el) {
      el.scrollIntoView({ block: 'start' })
    }
  }, [settings.fileView])

  const handleViewedChange = useCallback((filePath: string, viewed: boolean) => {
    setViewed(filePath, viewed)
  }, [setViewed])

  if (!loaded || loading) {
    return (
      <div className="loading">
        <p>Loading diff...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error">
        <p>Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="app">
      <Toolbar
        repoName={repoName}
        branch={branch}
        fileCount={files.length}
        additions={diffStats.additions}
        deletions={diffStats.deletions}
        commentCount={comments.length}
        diffStyle={settings.diffStyle}
        diffOptions={{ staged: settings.staged, untracked: settings.untracked }}
        defaultTabSize={settings.defaultTabSize}
        browser={settings.browser}
        fileView={settings.fileView}
        lineWrap={settings.lineWrap}
        customMode={customMode}
        onDiffStyleChange={(style) => updateSettings({ diffStyle: style })}
        onDiffOptionsChange={(options) => updateSettings(options)}
        onDefaultTabSizeChange={(size) => updateSettings({ defaultTabSize: size })}
        onBrowserChange={(browser) => updateSettings({ browser })}
        onFileViewChange={(view) => updateSettings({ fileView: view })}
        onLineWrapChange={(wrap) => updateSettings({ lineWrap: wrap })}
        onFinishReview={handleFinishReview}
        onCopyComments={copyAllComments}
      />
      {stale && (
        <div className="reload-banner" role="status">
          <span>The working tree changed since this diff was loaded.</span>
          <button className="btn btn-sm btn-primary" onClick={handleReload}>
            Reload diff
          </button>
        </div>
      )}
      <div className="app-body">
        <aside className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <FileTree
            files={files}
            activeFile={activeFile}
            commentCounts={commentCounts}
            viewedFiles={viewedFiles}
            untrackedFiles={untrackedSet}
            onFileClick={handleFileClick}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          />
          {!sidebarCollapsed && <CommentTracker comments={comments} />}
        </aside>
        <main className="main" ref={diffViewerRef}>
          <DiffViewer
            files={files}
            diffStyle={settings.diffStyle}
            tabSizeMap={tabSizeMap}
            defaultTabSize={settings.defaultTabSize}
            viewedFiles={viewedFiles}
            binaryFiles={binaryFileMap}
            fileView={settings.fileView}
            lineWrap={settings.lineWrap}
            activeFile={activeFile}
            onActiveFileChange={setActiveFile}
            onViewedChange={handleViewedChange}
            fileAnnotationsMap={fileAnnotationsMap}
            onAddComment={addComment}
            onDeleteComment={removeComment}
            onResolveComment={resolveComment}
            onUnresolveComment={unresolveComment}
            onReplyComment={addReply}
            onEditComment={editComment}
          />
        </main>
      </div>
    </div>
  )
}
