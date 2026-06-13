import { useState, memo } from 'react'
import { FileDiff } from '@pierre/diffs/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { DiffLineAnnotation, FileDiffMetadata, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment } from '../../types'
import { CommentForm } from './CommentForm'
import { CommentBubble } from './CommentBubble'

interface PendingComment {
  side: AnnotationSide
  lineNumber: number
}

export interface PagerInfo {
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
}

interface FileDiffCardProps {
  id?: string
  fileDiff: FileDiffMetadata
  filePath: string
  annotations: DiffLineAnnotation<ReviewComment>[]
  diffStyle: 'split' | 'unified'
  tabSize: number
  lineWrap: boolean
  viewed: boolean
  pager?: PagerInfo
  onViewedChange: (filePath: string, viewed: boolean) => void
  onAddComment: (filePath: string, side: AnnotationSide, lineNumber: number, lineContent: string, body: string) => void
  onDeleteComment: (id: string) => void
  onResolveComment: (id: string) => void
  onUnresolveComment: (id: string) => void
  onReplyComment: (id: string, body: string) => void
  onEditComment: (id: string, body: string) => void
}

export const FileDiffCard = memo(function FileDiffCard({
  id,
  fileDiff,
  filePath,
  annotations,
  diffStyle,
  tabSize,
  lineWrap,
  viewed,
  pager,
  onViewedChange,
  onAddComment,
  onDeleteComment,
  onResolveComment,
  onUnresolveComment,
  onReplyComment,
  onEditComment,
}: FileDiffCardProps) {
  const [pending, setPending] = useState<PendingComment | null>(null)

  const additions = fileDiff.additionLines.length
  const deletions = fileDiff.deletionLines.length

  const getLineContent = (side: AnnotationSide, lineNumber: number): string => {
    const lines = side === 'additions' ? fileDiff.additionLines : fileDiff.deletionLines
    // Full (non-partial) diffs carry the entire file, so any line — including
    // expanded context outside hunks — can be addressed directly.
    if (!fileDiff.isPartial) {
      return lines[lineNumber - 1] ?? ''
    }
    const startKey = side === 'additions' ? 'additionStart' : 'deletionStart'
    const countKey = side === 'additions' ? 'additionCount' : 'deletionCount'
    const indexKey = side === 'additions' ? 'additionLineIndex' : 'deletionLineIndex'
    for (const hunk of fileDiff.hunks) {
      const start = hunk[startKey]
      const count = hunk[countKey]
      if (lineNumber >= start && lineNumber < start + count) {
        const index = hunk[indexKey] + (lineNumber - start)
        return lines[index] ?? ''
      }
    }
    return ''
  }

  const allAnnotations: DiffLineAnnotation<ReviewComment | { _pending: true }>[] = [
    ...annotations,
    ...(pending
      ? [
          {
            side: pending.side,
            lineNumber: pending.lineNumber,
            metadata: { _pending: true as const },
          },
        ]
      : []),
  ]

  // Our own sticky header (the library's built-in header is disabled below).
  // Sticking it lets you mark a file viewed without scrolling back up.
  const header = (
    <div className="fdc-header">
      {pager && (
        <div className="fdc-pager">
          <button
            className="btn btn-sm"
            onClick={pager.onPrev}
            disabled={pager.index <= 0}
            title="Previous file ([)"
            aria-label="Previous file"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="btn btn-sm"
            onClick={pager.onNext}
            disabled={pager.index >= pager.total - 1}
            title="Next file (])"
            aria-label="Next file"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
      <span className="fdc-filename" title={filePath}>
        {filePath}
      </span>
      {pager && (
        <span className="fdc-counter">
          {pager.index + 1} / {pager.total}
        </span>
      )}
      <span className="fdc-stats">
        {additions > 0 && <span className="stat-additions">+{additions}</span>}
        {deletions > 0 && <span className="stat-deletions">-{deletions}</span>}
      </span>
      <label className="viewed-label" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={viewed}
          onChange={(e) => onViewedChange(filePath, e.target.checked)}
        />
        Viewed
      </label>
    </div>
  )

  return (
    <div className={`file-diff-card ${viewed ? 'file-diff-viewed' : ''}`} id={id}>
      {header}
      {!viewed && (
        <FileDiff<ReviewComment | { _pending: true }>
          fileDiff={fileDiff}
          options={{
            diffStyle,
            expansionLineCount: 20,
            enableGutterUtility: true,
            disableFileHeader: true,
            overflow: lineWrap ? 'wrap' : 'scroll',
            theme: { dark: 'github-dark', light: 'github-light' },
            themeType: 'system',
            unsafeCSS: `:host { --diffs-tab-size: ${tabSize}; }`,
          }}
          lineAnnotations={allAnnotations}
          renderAnnotation={(annotation) => {
            if ('_pending' in annotation.metadata) {
              return (
                <CommentForm
                  onSubmit={(body) => {
                    const lineContent = getLineContent(pending!.side, pending!.lineNumber)
                    onAddComment(filePath, pending!.side, pending!.lineNumber, lineContent, body)
                    setPending(null)
                  }}
                  onCancel={() => setPending(null)}
                />
              )
            }
            return (
              <CommentBubble
                comment={annotation.metadata as ReviewComment}
                onDelete={onDeleteComment}
                onResolve={onResolveComment}
                onUnresolve={onUnresolveComment}
                onReply={onReplyComment}
                onEdit={onEditComment}
              />
            )
          }}
          renderGutterUtility={(getHoveredLine) => (
            <button
              className="gutter-add-btn"
              onClick={() => {
                const line = getHoveredLine()
                if (line) {
                  setPending({ side: line.side, lineNumber: line.lineNumber })
                }
              }}
            >
              +
            </button>
          )}
        />
      )}
    </div>
  )
})
