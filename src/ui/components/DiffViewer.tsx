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

  // Resolve the active file index, defaulting to the first file when nothing
  // is selected yet or the selection no longer exists in the diff.
  const activeIndex = useMemo(() => {
    if (!isSingle) return -1
    const i = sortedFiles.findIndex((f) => f.name === activeFile)
    return i >= 0 ? i : 0
  }, [isSingle, sortedFiles, activeFile])

  // Keep the sidebar highlight in sync when the active file was defaulted.
  useEffect(() => {
    if (!isSingle || sortedFiles.length === 0) return
    const resolved = sortedFiles[activeIndex]?.name
    if (resolved && resolved !== activeFile) onActiveFileChange(resolved)
  }, [isSingle, activeIndex, sortedFiles, activeFile, onActiveFileChange])

  const goTo = useCallback(
    (delta: number) => {
      if (sortedFiles.length === 0) return
      const next = Math.min(sortedFiles.length - 1, Math.max(0, activeIndex + delta))
      onActiveFileChange(sortedFiles[next].name)
    },
    [activeIndex, sortedFiles, onActiveFileChange],
  )

  // GitLab-style file navigation: `[` previous file, `]` next file.
  useEffect(() => {
    if (!isSingle) return
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
  }, [isSingle, goTo])

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
        />
      )
    },
    [binaryFiles, viewedFiles, fileAnnotationsMap, diffStyle, tabSizeMap, defaultTabSize, onViewedChange, onAddComment, onDeleteComment],
  )

  if (sortedFiles.length === 0) {
    return (
      <div className="empty-state">
        <p>No changes found.</p>
      </div>
    )
  }

  if (isSingle) {
    return (
      <div className="diff-viewer">
        <div className="diff-file-nav">
          <button
            className="btn btn-sm"
            onClick={() => goTo(-1)}
            disabled={activeIndex <= 0}
            title="Previous file ([)"
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
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
        {renderFile(sortedFiles[activeIndex], activeIndex)}
      </div>
    )
  }

  return <div className="diff-viewer">{sortedFiles.map(renderFile)}</div>
})
