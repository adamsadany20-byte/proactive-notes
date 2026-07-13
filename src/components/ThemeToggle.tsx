import { useReducer } from 'react'
import { applyTheme, getTheme, type Theme } from '../services/theme'

// Switches between the two full designs: "Modern" (default, floating panels +
// editorial serif) and "Earthy" (the original — flat warm palette, tucked-corner
// shapes, Inter headings). Lives in Settings & tools; the same choice is offered
// up front in onboarding.
//
// Reads the live theme from the DOM on every render (rather than holding local
// state) so it stays in sync even when the theme was set elsewhere — e.g. the
// onboarding prompt.
export function ThemeToggle() {
  const [, force] = useReducer((n: number) => n + 1, 0)
  const theme: Theme = getTheme()

  const apply = (next: Theme) => {
    applyTheme(next)
    force()
  }

  return (
    <div className="theme-toggle">
      <strong className="tt-label">Design</strong>
      <div className="tt-seg" role="radiogroup" aria-label="Design theme">
        <button
          className={`tt-opt ${theme === 'earthy' ? 'on' : ''}`}
          role="radio"
          aria-checked={theme === 'earthy'}
          onClick={() => apply('earthy')}
        >
          Earthy
        </button>
        <button
          className={`tt-opt ${theme === 'modern' ? 'on' : ''}`}
          role="radio"
          aria-checked={theme === 'modern'}
          onClick={() => apply('modern')}
        >
          Modern
        </button>
      </div>
      <span className="tt-note">
        {theme === 'earthy'
          ? 'The original — warm and flat.'
          : 'Floating panels, editorial serif.'}
      </span>
    </div>
  )
}
