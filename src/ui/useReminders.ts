import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/appStore'
import type { ChecklistItem } from '../types'
import { computeStreak, isExpectedOn, sessionDates, todayIso } from '../store/streak'

// Watches one-off checklist reminders and recurring goal reminders. When one
// comes due (while the app is open), it raises an in-app toast plus a browser
// notification if permission was granted. Fired reminders are keyed so nothing
// double-fires within a session.
export function useReminders() {
  const { state } = useStore()
  const fired = useRef<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = (text: string, title = 'Reminder') => {
    setToast(text)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setToast(null), 8000)
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { body: text })
      } catch {
        /* notifications best-effort */
      }
    }
  }

  useEffect(() => {
    const tick = () => {
      const now = Date.now()
      // One-off checklist item reminders.
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
            }
          }
        }
      }

      // Streak reminders — nudge once their time-of-day arrives on an expected
      // day (a recurring weekday, or a scheduled session date) if not yet done.
      const today = todayIso()
      for (const r of state.reminders) {
        const note = state.notes.find((n) => n.id === r.noteId)
        const dueToday =
          r.mode === 'sessions'
            ? !!note && sessionDates(note).includes(today)
            : isExpectedOn(r, today)
        if (!dueToday) continue
        if (r.completions.includes(today)) continue
        const [h, m] = r.time.split(':').map(Number)
        const at = new Date()
        at.setHours(h || 0, m || 0, 0, 0)
        if (at.getTime() > now) continue
        const key = `rem:${r.id}@${today}`
        if (fired.current.has(key)) continue
        fired.current.add(key)
        const { current } = computeStreak(r, note)
        const noun = r.mode === 'sessions' ? 'session' : 'day'
        const tail =
          current > 0
            ? ` — keep your ${current}-${noun} streak alive 🔥`
            : ' — light your first flame 🌱'
        show(`${r.title}${tail}`, 'Time to check in')
      }
    }
    tick()
    const id = setInterval(tick, 20000)
    return () => clearInterval(id)
  }, [state.notes, state.reminders])

  return { toast, dismiss: () => setToast(null) }
}
