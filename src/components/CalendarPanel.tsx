import { useStore } from '../store/appStore'
import type { CalendarEvent } from '../types'
import { relativeDay } from '../store/calendar'
import { connectCalendar, disconnectCalendar } from '../services/api'

const KIND_COLOR: Record<CalendarEvent['kind'], string> = {
  fixed: 'var(--general)',
  test: 'var(--academic)',
  study: '#7cb8ff',
  event: 'var(--event)',
  briefing: 'var(--project)',
}

const KIND_LABEL: Partial<Record<CalendarEvent['kind'], string>> = {
  test: 'Test',
  study: 'Study',
  event: 'Event',
  briefing: 'Briefing',
}

function byTime(a: CalendarEvent, b: CalendarEvent): number {
  return (a.start ?? '').localeCompare(b.start ?? '')
}

function CalendarConnect() {
  const { state, setExternalEvents, setConfig } = useStore()
  const cfg = state.config
  if (!cfg) return null
  if (!cfg.calendarConfigured) {
    return (
      <span className="cal-conn hint" title="Set Google credentials in server/.env">
        local mode
      </span>
    )
  }
  if (cfg.calendarConnected) {
    return (
      <button
        className="cal-conn"
        onClick={async () => {
          await disconnectCalendar()
          setExternalEvents([])
          setConfig({ ...cfg, calendarConnected: false })
        }}
      >
        ✓ Google · disconnect
      </button>
    )
  }
  return (
    <button className="cal-conn connect" onClick={connectCalendar}>
      Connect Google
    </button>
  )
}

export function CalendarPanel() {
  const { state } = useStore()

  // Group upcoming events by day (today → +14d).
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + 14)

  const groups = new Map<string, CalendarEvent[]>()
  for (const e of state.calendar) {
    const d = new Date(e.date + 'T00:00:00')
    if (d < today || d > horizon) continue
    if (!groups.has(e.date)) groups.set(e.date, [])
    groups.get(e.date)!.push(e)
  }
  const days = Array.from(groups.keys()).sort()

  return (
    <div className="col col-cal">
      <div className="cal-head">
        📆 Calendar
        <span className="cal-conn-slot">
          <CalendarConnect />
        </span>
      </div>
      <div className="cal-list">
        {days.length === 0 && (
          <div className="cal-empty">
            Your week’s clear. Anything I schedule for you lands here.
          </div>
        )}
        {days.map((iso) => {
          const events = groups.get(iso)!.sort(byTime)
          return (
            <div key={iso} className="cal-daygroup">
              <div className="cal-dayhead">{relativeDay(iso)}</div>
              {events.map((e) => (
                <div
                  key={e.id}
                  className={`cal-event ${e.noteId ? 'is-new' : ''} ${
                    e.source === 'google' ? 'is-google' : ''
                  }`}
                >
                  <span
                    className="ce-bar"
                    style={{ background: KIND_COLOR[e.kind] }}
                  />
                  <div className="ce-main">
                    <div className="ce-title">{e.title}</div>
                    {e.start && (
                      <div className="ce-time">
                        {e.start}
                        {e.end ? `–${e.end}` : ''}
                      </div>
                    )}
                  </div>
                  {KIND_LABEL[e.kind] && (
                    <span
                      className="ce-tag"
                      style={{ color: KIND_COLOR[e.kind] }}
                    >
                      {KIND_LABEL[e.kind]}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
