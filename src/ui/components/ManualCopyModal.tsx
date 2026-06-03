import { useEffect, useRef } from 'react'

interface ManualCopyModalProps {
  text: string
  onClose: () => void
}

/**
 * Last-resort copy path shown when both the Clipboard API and execCommand
 * fail. Presents the text in a pre-selected textarea so the user can copy it
 * manually (Ctrl/Cmd-C) instead of being left with nothing.
 */
export function ManualCopyModal({ text, onClose }: ManualCopyModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <p className="modal-title">Couldn’t copy automatically</p>
        <p className="modal-hint">
          Your browser blocked clipboard access (common over plain http on a LAN
          IP). Select all and press Ctrl/Cmd-C:
        </p>
        <textarea ref={textareaRef} className="modal-textarea" readOnly value={text} />
        <div className="modal-actions">
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
