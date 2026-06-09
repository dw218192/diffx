import { useEffect } from 'react'

/**
 * Signals reviewer presence so a `--tab-shutdown` server can tell a departed
 * reviewer from an idle one (an agent polling between rounds). Two signals,
 * matching how the server detects a tab close:
 *   - heartbeat: POST /api/heartbeat every 5s. If the lid closes or Wi-Fi
 *     drops (half-open socket, no FIN), the beats stop and the server reaps
 *     itself after a grace.
 *   - beacon: navigator.sendBeacon('/api/finish?closed=1') on pagehide — the
 *     graceful "tab is going away" hint, which fires during unload when a
 *     normal fetch wouldn't survive.
 * Both are harmless no-ops against a server launched without --tab-shutdown.
 */
export function useReviewerPresence() {
  useEffect(() => {
    const beat = () => {
      void fetch('/api/heartbeat', { method: 'POST', keepalive: true }).catch(() => {})
    }
    beat()
    const id = setInterval(beat, 5000)

    const onPageHide = () => {
      try {
        navigator.sendBeacon('/api/finish?closed=1')
      } catch {
        // sendBeacon unavailable — the heartbeat-timeout path still reaps the server.
      }
    }
    window.addEventListener('pagehide', onPageHide)

    return () => {
      clearInterval(id)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])
}
