import { memo, useMemo, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { FileDiffMetadata, DiffLineAnnotation, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import type { BinaryFileInfo } from '../hooks/useDiff'
import { FileDiffCard } from './FileDiffCard'
import { BinaryFileDiff } from './BinaryFileDiff'

interface DiffViewerProps {
  files: FileDiffMetadata[]
  diffStyle: 'split' | 'unified'
  tabSizeMap: Record<string, number>
  defaultTabSize: number
  viewedFiles: Set<string>
  binaryFiles: Map<string, BinaryFileInfo>
  fileView: 'list' | 'single'
  activeFile: string | null
  onActiveFileChange: (filePath: string) => void
  onViewedChange: (filePath: string, viewed: boolean) => void
  fileAnnotationsMap: Map<string, DiffLineAnnotation<ReviewComment>[]>
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string) => void
  onDeleteComment: (id: string) => void
  onResolveComment: (id: string) => void
  onUnresolveComment: (id: string) => void
  onReplyComment: (id: string, body: string) => void
}

const emptyAnnotations: DiffLineAnnotation<ReviewComment>[] = []

export const DiffViewer = memo(function DiffViewer({
  files,
  diffStyle,
  tabSizeMap,
  defaultTabSize,
  viewedFiles,
  binaryFiles,
  fileView,
  activeFile,
  onActiveFileChange,
  onViewedChange,
  fileAnnotationsMap,
  onAddComment,
  onDeleteComment,
  onResolveComment,
  onUnresolveComment,
  onReplyComment,
}: DiffViewerProps) {
  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      const partsA = a.name.split('/')
      const partsB = b.name.split('/')
      const len = Math.min(partsA.length, partsB.length)
      for (let i = 0; i < len; i++) {
        const aIsDir = i < partsA.length - 1
        const bIsDir = i < partsB.length - 1
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
        const cmp = partsA[i].localeCompare(partsB[i])
        if (cmp !== 0) return cmp
      }
      return partsA.length - partsB.length
    })
  }, [files])

  const isSingle = fileView === 'single'

  // Index of the active file, defaulting to the first when nothing is selected
  // yet or the selection no longer exists in the diff.
  const activeIndex = useMemo(() => {
    const i = sortedFiles.findIndex((f) => f.name === activeFile)
    return i >= 0 ? i : 0
  }, [sortedFiles, activeFile])

  // In single-file view, keep the sidebar highlight in sync when the active
  // file was defaulted (nothing selected / stale selection).
  useEffect(() => {
    if (!isSingle || sortedFiles.length === 0) return
    const resolved = sortedFiles[activeIndex]?.name
    if (resolved && resolved !== activeFile) onActiveFileChange(resolved)
  }, [isSingle, activeIndex, sortedFiles, activeFile, onActiveFileChange])

  const goTo = useCallback(
    (delta: number) => {
      if (sortedFiles.length === 0) return
      const next = Math.min(sortedFiles.length - 1, Math.max(0, activeIndex + delta))
      const name = sortedFiles[next].name
      onActiveFileChange(name)
      // List view keeps every file mounted, so move by scrolling to the card.
      if (!isSingle) {
        document.getElementById(`file-${name}`)?.scrollIntoView({ block: 'start' })
      }
    },
    [isSingle, activeIndex, sortedFiles, onActiveFileChange],
  )

  // `[` previous file, `]` next file (GitLab parity), in both views.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
      if (e.key === ']') {
        e.preventDefault()
        goTo(1)
      } else if (e.key === '[') {
        e.preventDefault()
        goTo(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo])

  // List view: track the file at the top of the viewport so the sidebar
  // highlight follows scrolling (GitHub behavior).
  useEffect(() => {
    if (isSingle || sortedFiles.length === 0) return
    const tops = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const name = e.target.id.slice('file-'.length)
          if (e.isIntersecting) tops.set(name, e.boundingClientRect.top)
          else tops.delete(name)
        }
        let best: string | null = null
        let bestTop = Infinity
        for (const [name, top] of tops) {
          if (top < bestTop) {
            bestTop = top
            best = name
          }
        }
        if (best) onActiveFileChange(best)
      },
      { rootMargin: '-60px 0px -75% 0px' },
    )
    for (const f of sortedFiles) {
      const el = document.getElementById(`file-${f.name}`)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [isSingle, sortedFiles, onActiveFileChange])

  const renderFile = useCallback(
    (file: FileDiffMetadata, index: number) => {
      const filePath = file.name
      const binaryInfo = binaryFiles.get(filePath)
      if (binaryInfo) {
        return (
          <BinaryFileDiff
            key={`${filePath}-${index}`}
            filePath={filePath}
            info={binaryInfo}
            viewed={viewedFiles.has(filePath)}
            onViewedChange={onViewedChange}
          />
        )
      }
      return (
        <FileDiffCard
          key={`${filePath}-${index}`}
          id={`file-${filePath}`}
          fileDiff={file}
          filePath={filePath}
          annotations={fileAnnotationsMap.get(filePath) ?? emptyAnnotations}
          diffStyle={diffStyle}
          tabSize={tabSizeMap[filePath] ?? defaultTabSize}
          viewed={viewedFiles.has(filePath)}
          onViewedChange={onViewedChange}
          onAddComment={onAddComment}
          onDeleteComment={onDeleteComment}
          onResolveComment={onResolveComment}
          onUnresolveComment={onUnresolveComment}
          onReplyComment={onReplyComment}
        />
      )
    },
    [binaryFiles, viewedFiles, fileAnnotationsMap, diffStyle, tabSizeMap, defaultTabSize, onViewedChange, onAddComment, onDeleteComment, onResolveComment, onUnresolveComment, onReplyComment],
  )

  if (sortedFiles.length === 0) {
    return (
      <div className="empty-state">
        <p>No changes found.</p>
      </div>
    )
  }

  return (
    <div className="diff-viewer">
      {isSingle && (
        <div className="diff-file-nav">
          <button
            className="btn btn-sm"
            onClick={() => goTo(-1)}
            disabled={activeIndex <= 0}
            title="Previous file ([)"
            aria-label="Previous file"
          >
            <ChevronLeft size={14} />
            Prev
          </button>
          <span className="diff-file-nav-counter">
            File {activeIndex + 1} of {sortedFiles.length}
          </span>
          <button
            className="btn btn-sm"
            onClick={() => goTo(1)}
            disabled={activeIndex >= sortedFiles.length - 1}
            title="Next file (])"
            aria-label="Next file"
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      )}
      {isSingle ? renderFile(sortedFiles[activeIndex], activeIndex) : sortedFiles.map(renderFile)}
    </div>
  )
})
