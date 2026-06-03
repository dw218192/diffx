export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function truncate(text: string, maxLen: number): string {
  const firstLine = text.split('\n')[0]
  if (firstLine.length <= maxLen) return firstLine
  return firstLine.slice(0, maxLen) + '…'
}

export function fileName(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1]
}

/**
 * Copy text to the clipboard, falling back to a hidden textarea + execCommand
 * when the async Clipboard API is unavailable. navigator.clipboard only exists
 * in secure contexts (HTTPS or localhost), so the fallback is required when
 * diffx is served over plain http on a LAN IP (e.g. `diffx --host 0.0.0.0`).
 *
 * Returns true if the text was copied, false if every method failed — callers
 * should offer a manual-copy path on false rather than failing silently.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall back below.
    }
  }

  return copyTextLegacy(text)
}

/**
 * Legacy fallback for non-secure contexts: drop the text into an off-screen
 * textarea, select it, and copy the selection. execCommand('copy') is
 * deprecated but it is the only copy API that works when navigator.clipboard
 * is unavailable (e.g. plain http on a LAN IP).
 */
function copyTextLegacy(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.setAttribute('readonly', '') // avoid popping the mobile keyboard
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}
