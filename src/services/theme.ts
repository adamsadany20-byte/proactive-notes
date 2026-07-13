// Shared design-theme helpers, used by both the first-run Onboarding prompt and
// the Settings → Design toggle. The theme lives on <html data-theme> +
// localStorage; index.html applies it before first paint so there's no flash.

export type Theme = 'modern' | 'earthy'

const THEME_KEY = 'evolve.theme'
const ONBOARDED_KEY = 'evolve.onboarded'

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'earthy' ? 'earthy' : 'modern'
}

// Apply a theme to the document. "modern" is the base stylesheet, so it clears
// the attribute rather than setting it.
export function applyTheme(theme: Theme, persist = true): void {
  if (theme === 'modern') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }
}

// Show onboarding only for genuinely new users — those who have neither finished
// it before nor already picked a theme (existing toggle-users aren't re-prompted).
export function needsOnboarding(): boolean {
  try {
    return (
      localStorage.getItem(ONBOARDED_KEY) !== '1' &&
      localStorage.getItem(THEME_KEY) == null
    )
  } catch {
    return false
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1')
  } catch {
    /* ignore */
  }
}
