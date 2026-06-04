import { useState, useEffect } from 'react'
import { UserCircle, CheckCircle2, Bot, Reply, ChevronRight } from 'lucide-react'
import type { ReviewComment, CommentReply } from '../../types'
import { timeAgo, truncate } from '../utils'
import { CommentForm } from './CommentForm'

interface CommentBubbleProps {
  comment: ReviewComment
  onDelete: (id: string) => void
  onResolve: (id: string) => void
  onUnresolve: (id: string) => void
  onReply: (id: string, body: string) => void
}

export function CommentBubble({ comment, onDelete, onResolve, onUnresolve, onReply }: CommentBubbleProps) {
  const [, setTick] = useState(0)
  const isResolved = comment.status === 'resolved'
  // Whether a resolved thread has been manually expanded. Resolved threads
  // start (and re-collapse on resolve) as a one-line summary, like GitHub.
  const [expandedResolved, setExpandedResolved] = useState(false)
  const [replying, setReplying] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  const handleResolve = () => {
    onResolve(comment.id)
    setExpandedResolved(false)
  }

  if (isResolved && !expandedResolved) {
    return (
      <div className="comment-bubble comment-resolved comment-collapsed" id={`comment-${comment.id}`}>
        <button className="comment-collapse-toggle" onClick={() => setExpandedResolved(true)} title="Expand">
          <ChevronRight size={14} className="comment-collapse-chevron" />
          <CheckCircle2 size={14} />
          <span className="comment-bubble-resolved-label">Resolved</span>
          <span className="comment-collapsed-preview">{truncate(comment.body, 60)}</span>
        </button>
        <button className="comment-bubble-action" onClick={() => onUnresolve(comment.id)}>
          Unresolve
        </button>
      </div>
    )
  }

  return (
    <div className={`comment-bubble ${isResolved ? 'comment-resolved' : ''}`} id={`comment-${comment.id}`}>
      <div className="comment-bubble-header">
        <UserCircle size={18} className="comment-bubble-avatar" />
        <span className="comment-bubble-time">{timeAgo(comment.createdAt)}</span>
        {isResolved && (
          <span className="comment-bubble-resolved">
            <CheckCircle2 size={14} />
            Resolved
          </span>
        )}
        <div className="comment-bubble-actions">
          {isResolved ? (
            <>
              <button className="comment-bubble-action" onClick={() => setExpandedResolved(false)}>
                Collapse
              </button>
              <button className="comment-bubble-action" onClick={() => onUnresolve(comment.id)}>
                Unresolve
              </button>
            </>
          ) : (
            <button className="comment-bubble-action" onClick={handleResolve}>
              Resolve
            </button>
          )}
          <button
            className="comment-bubble-delete"
            onClick={() => onDelete(comment.id)}
            title="Delete comment"
          >
            &times;
          </button>
        </div>
      </div>
      <div className="comment-bubble-body">{comment.body}</div>
      {comment.replies?.length > 0 && (
        <div className="comment-replies">
          {comment.replies.map((reply) => (
            <ReplyItem key={reply.id} reply={reply} />
          ))}
        </div>
      )}
      {replying ? (
        <CommentForm
          placeholder="Reply..."
          submitLabel="Reply"
          onSubmit={(body) => {
            onReply(comment.id, body)
            setReplying(false)
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <button className="comment-reply-btn" onClick={() => setReplying(true)}>
          <Reply size={14} />
          Reply
        </button>
      )}
    </div>
  )
}

function ReplyItem({ reply }: { reply: CommentReply }) {
  // Replies default to 'agent' (legacy API replies had no author); only
  // replies typed in the UI are 'user'.
  const isUser = reply.author === 'user'
  return (
    <div className="comment-reply">
      <div className="comment-reply-header">
        {isUser ? (
          <UserCircle size={16} className="comment-reply-avatar" />
        ) : (
          <Bot size={16} className="comment-reply-avatar comment-reply-avatar-agent" />
        )}
        <span className="comment-bubble-time">{timeAgo(reply.createdAt)}</span>
      </div>
      <div className="comment-reply-body">{reply.body}</div>
    </div>
  )
}
