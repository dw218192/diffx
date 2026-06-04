import { useState, useRef, useEffect } from 'react'

interface CommentFormProps {
  onSubmit: (body: string) => void
  onCancel: () => void
  placeholder?: string
  submitLabel?: string
  initialValue?: string
}

export function CommentForm({
  onSubmit,
  onCancel,
  placeholder = 'Leave a review comment...',
  submitLabel = 'Comment',
  initialValue = '',
}: CommentFormProps) {
  const [body, setBody] = useState(initialValue)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    // Put the caret at the end when editing existing text.
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const handleSubmit = () => {
    const trimmed = body.trim()
    if (trimmed) {
      onSubmit(trimmed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <div className="comment-form">
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={3}
      />
      <div className="comment-form-actions">
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={!body.trim()}>
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
