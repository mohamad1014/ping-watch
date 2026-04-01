import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { resolveServiceWorkerUrl } from './pwaPaths'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(resolveServiceWorkerUrl(import.meta.env.BASE_URL)).catch((err) => {
      console.warn('Service worker registration failed', err)
    })
  })
}
