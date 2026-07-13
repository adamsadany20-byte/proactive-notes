import { useState } from 'react'
import { applyTheme, markOnboarded, type Theme } from '../services/theme'
import { StarSixIcon } from '../ui/icons'

// A tiny, self-contained mock of each design so the choice is visual, not just
// words. Deliberately styled with hardcoded per-theme looks (serif+float+round
// vs sans+flat+tucked-corner) so both read correctly side by side regardless of
// which theme is currently live.
function Preview({ theme }: { theme: Theme }) {
  return (
    <div className={`op-preview ${theme}`} aria-hidden>
      <div className="pv-card">
        <span className="pv-title">Aa</span>
        <span className="pv-line" />
        <span className="pv-line short" />
      </div>
      <span className="pv-pill" />
    </div>
  )
}

// First-run prompt: pick a look. Selecting a card live-applies the theme to the
// whole app behind the translucent scrim, so you see the real thing before
// committing. Changeable anytime later in Settings → Design.
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [choice, setChoice] = useState<Theme>('modern')

  const pick = (t: Theme) => {
    setChoice(t)
    applyTheme(t, false) // live preview only — don't persist until Continue
  }

  const finish = () => {
    applyTheme(choice)
    markOnboarded()
    onDone()
  }

  const options: { id: Theme; name: string; desc: string }[] = [
    { id: 'modern', name: 'Modern', desc: 'Floating panels, editorial serif.' },
    { id: 'earthy', name: 'Earthy', desc: 'Warm, flat, and original.' },
  ]

  return (
    <div className="onboard-scrim" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="onboard-card">
        <div className="onboard-emblem" aria-hidden>
          <StarSixIcon />
        </div>
        <h1 className="onboard-title" id="onboard-title">
          Make Evolve yours
        </h1>
        <p className="onboard-lead">
          Choose a look to start with. You can switch anytime in Settings.
        </p>

        <div className="onboard-choices" role="radiogroup" aria-label="Design style">
          {options.map((o) => (
            <button
              key={o.id}
              className={`op-card ${choice === o.id ? 'on' : ''}`}
              role="radio"
              aria-checked={choice === o.id}
              onClick={() => pick(o.id)}
            >
              <Preview theme={o.id} />
              <span className="op-name">{o.name}</span>
              <span className="op-desc">{o.desc}</span>
            </button>
          ))}
        </div>

        <button className="onboard-go" onClick={finish}>
          Continue
        </button>
      </div>
    </div>
  )
}
