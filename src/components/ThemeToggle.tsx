import { useState } from 'react'

// Switches between the two full designs: "Modern" (default, floating panels +
// editorial serif) and "Earthy" (the original — flat warm palette, tucked-corner
// shapes, Inter headings). The choice lives on <html data-theme> and localStorage;
// a tiny inline script in index.html applies it before first paint (no flash).
type Theme = 'modern' | 'earthy'

const STORAGE_KEY = 'evolve.theme'

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'earthy' ? 'earthy' : 'modern'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme)

  const apply = (next: Theme) => {
    setTheme(next)
    // "modern" is the base stylesheet, so we clear the attribute rather than set it.
    if (next === 'modern') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore quota / privacy-mode errors */
    }
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
