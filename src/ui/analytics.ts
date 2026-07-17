import { sendEvents, type AnalyticsEvent } from '../services/api'

// Tiny client-side event batcher for owner product analytics. Events are
// buffered and flushed together (every few seconds, when the buffer fills, or on
// page hide) so we're not firing a request per action. No PII — just event names
// and small non-sensitive props. Best-effort: any failure is swallowed.
let buffer: AnalyticsEvent[] = []
let timer: number | undefined

function flush() {
  if (!buffer.length) return
  const batch = buffer
  buffer = []
  sendEvents(batch)
}

export function track(name: string, props?: Record<string, unknown>): void {
  buffer.push({ name, props, at: Date.now() })
  if (buffer.length >= 10) {
    flush()
    return
  }
  if (typeof window !== 'undefined') {
    window.clearTimeout(timer)
    timer = window.setTimeout(flush, 4000)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
