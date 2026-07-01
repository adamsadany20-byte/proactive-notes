import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/appStore'
import type { ChecklistItem } from '../types'

// Watches every checklist item across all notes and, when a reminder comes due
// (while the app is open), raises an in-app toast plus a browser notification if
// permission was granted. Fired reminders are keyed by id+time so re-scheduling
// works but nothing double-fires within a session.
export function useReminders() {
  const { state } = useStore()
  const fired = useRef<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = (text: string) => {
    setToast(text)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setToast(null), 8000)
  }

  useEffect(() => {
    const tick = () => {
      const now = Date.now()
      for (const note of state.notes) {
        for (const seg of note.segments) {
          const items = seg.data?.items as ChecklistItem[] | undefined
          if (!items) continue
          for (const it of items) {
            if (!it.remindAt || it.done) continue
            const key = `${it.id}@${it.remindAt}`
            if (fired.current.has(key)) continue
            const t = new Date(it.remindAt).getTime()
            if (!isNaN(t) && t <= now) {
              fired.current.add(key)
              show(it.text)
              if ('Notification' in window && Notification.permission === 'granted') {
                try {
                  new Notification('Reminder', { body: it.text })
                } catch {
                  /* notifications best-effort */
                }
              }
            }
          }
        }
      }
    }
    tick()
    const id = setInterval(tick, 20000)
    return () => clearInterval(id)
  }, [state.notes])

  return { toast, dismiss: () => setToast(null) }
}
