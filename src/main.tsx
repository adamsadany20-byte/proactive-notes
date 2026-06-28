import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { StoreProvider } from './store/appStore'

window.addEventListener('error', (e) => {
  const el = document.getElementById('root')
  if (el && !el.children.length)
    el.innerHTML = `<pre style="padding:20px;color:#b00;white-space:pre-wrap">${
      e.error?.stack || e.message
    }</pre>`
})

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <StoreProvider>
        <App />
      </StoreProvider>
    </StrictMode>,
  )
} catch (err: any) {
  document.getElementById('root')!.innerHTML = `<pre style="padding:20px;color:#b00;white-space:pre-wrap">${
    err?.stack || String(err)
  }</pre>`
}
