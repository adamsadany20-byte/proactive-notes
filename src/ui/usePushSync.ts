import { useEffect, useRef } from 'react'
import { useStore } from '../store/appStore'
import { syncReminderSchedule } from '../services/push'

// Keeps the server's copy of the reminder schedule in step with the client so
// closed-app push notifications fire for the right things at the right time.
// Debounced, and a no-op until the device is actually subscribed (the sync fn
// bails early in that case). Runs whenever reminders or their completions change.
export function usePushSync() {
  const { state } = useStore()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      syncReminderSchedule(state.reminders, state.notes)
    }, 1200)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // Re-sync when the set of reminders or their completion logs change. Notes
    // are included because session dates are derived from a note's schedule.
  }, [state.reminders, state.notes])
}
