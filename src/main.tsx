import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { Landing } from './components/Landing'
import { StoreProvider } from './store/appStore'
import { isSupabaseEnabled, supabase } from './services/supabase'
import { AuthGate } from './components/AuthGate'
import { registerServiceWorker } from './services/push'

// Register the push/PWA service worker as soon as the app loads, so a device
// that already granted notification permission keeps receiving reminders.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    registerServiceWorker()
  })
}

window.addEventListener('error', (e) => {
  const el = document.getElementById('root')
  if (el && !el.children.length)
    el.innerHTML = `<pre style="padding:20px;color:#b00;white-space:pre-wrap">${
      e.error?.stack || e.message
    }</pre>`
})

try {
  // The marketing landing page (for ad traffic) lives at /welcome and skips the
  // app shell, store, and auth entirely — it just needs to load and capture
  // interest.
  const isLanding = window.location.pathname.replace(/\/$/, '') === '/welcome'

  const appContent = (
    <StoreProvider>
      <App />
    </StoreProvider>
  );

  const root = createRoot(document.getElementById('root')!);

  root.render(
    <StrictMode>
      {isLanding ? (
        <Landing />
      ) : isSupabaseEnabled ? (
        <AuthGate>{appContent}</AuthGate>
      ) : (
        appContent
      )}
    </StrictMode>,
  );
} catch (err: any) {
  document.getElementById('root')!.innerHTML = `<pre style="padding:20px;color:#b00;white-space:pre-wrap">${
    err?.stack || String(err)
  }</pre>`
}
