import { useState, useEffect } from 'react'

/**
 * Subscribes to server-sent working-tree change events. Instead of silently
 * refreshing (which would lose the reviewer's place), it exposes a `stale`
 * flag so the UI can surface a "content changed — reload" banner, mirroring
 * how GitHub/GitLab notify you that a diff has been updated.
 */
export function useLiveReload() {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    let source: EventSource | null = null
    try {
      source = new EventSource('/api/events')
      source.addEventListener('diff-changed', () => setStale(true))
    } catch {
      // EventSource unavailable — live reload is a progressive enhancement.
    }
    return () => source?.close()
  }, [])

  return { stale, reset: () => setStale(false) }
}
