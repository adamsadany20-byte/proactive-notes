import { useMemo, useState } from 'react'
import type { Note } from '../types'
import { useStore } from '../store/appStore'
import {
  detectListPattern,
  detectShoppingList,
  describeCadence,
} from '../engine/patterns'

// A lightweight, local-only "smart suggestions" strip shown under the editor.
// It reads the note text with the deterministic pattern engine (no network) and
// offers one-tap help: continue an ordered list, or turn a shopping list into a
// planned trip — learning the user's weekly shopping rhythm as it goes.
export function SmartSuggestions({
  note,
  onInsert,
}: {
  note: Note
  // Append text to the note body and refocus the editor (list continuation).
  onInsert: (text: string) => void
}) {
  const { state, logShopping } = useStore()
  const [planned, setPlanned] = useState(false)

  const list = useMemo(() => detectListPattern(note.text), [note.text])
  const shopping = useMemo(() => detectShoppingList(note.text), [note.text])
  const cadence = useMemo(
    () => describeCadence(state.habits.shoppingLog),
    [state.habits.shoppingLog],
  )

  const showList = !!list
  const showShopping = shopping.isShoppingList
  if (!showList && !showShopping) return null

  return (
    <div className="smart" role="group" aria-label="Smart suggestions">
      {showList && list && (
        <button
          className="smart-chip"
          onClick={() => onInsert(list.insert)}
          title={`Add ${list.label} and keep the list going`}
        >
          <span className="smart-ico" aria-hidden>
            ↳
          </span>
          Continue the list
          <span className="smart-next">{list.label}</span>
        </button>
      )}

      {showShopping && (
        <div className="smart-shop">
          <div className="smart-shop-head">
            <span className="smart-ico" aria-hidden>
              🛒
            </span>
            <span>
              Shopping list
              <span className="smart-count">
                {shopping.items.length} item{shopping.items.length === 1 ? '' : 's'}
              </span>
            </span>
          </div>

          {!planned ? (
            <div className="smart-shop-body">
              {cadence ? (
                <p className="smart-hint">
                  You usually shop <strong>{cadence.label}</strong> — want it down
                  for next {cadence.nextIso.slice(5)} at {cadence.time}?
                </p>
              ) : (
                <p className="smart-hint">
                  When do you want to go? I’ll remember your rhythm and stop asking.
                </p>
              )}
              <button
                className="smart-plan"
                onClick={() => {
                  logShopping()
                  setPlanned(true)
                }}
              >
                {cadence ? `Plan for ${cadence.label}` : 'Plan this shop'}
              </button>
            </div>
          ) : (
            <p className="smart-done">
              ✓ Shopping trip logged.
              {cadence
                ? ` I’ll keep suggesting ${cadence.label}.`
                : ' A couple more and I’ll learn your usual day & time.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
