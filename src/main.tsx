import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { StoreProvider } from './store/appStore'
import { isSupabaseEnabled, supabase } from './services/supabase'
import { AuthGate } from './components/AuthGate'

window.addEventListener('error', (e) => {
  const el = document.getElementById('root')
  if (el && !el.children.length)
    el.innerHTML = `<pre style="padding:20px;color:#b00;white-space:pre-wrap">${
      e.error?.stack || e.message
    }</pre>`
})

try {
  const appContent = (
    <StoreProvider>
      <App />
    </StoreProvider>
  );

  const root = createRoot(document.getElementById('root')!);

  root.render(
    <StrictMode>
      {isSupabaseEnabled ? (
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
