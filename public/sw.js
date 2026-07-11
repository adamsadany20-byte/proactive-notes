/* Evolve Notes service worker — Web Push for closed-app reminders.
 *
 * Kept intentionally tiny: it does not cache or intercept fetches (so it can
 * never serve a stale app). Its only job is to receive push messages and show
 * notifications, and to focus the app when one is tapped. */

self.addEventListener('install', () => {
  // Activate immediately so a freshly-registered worker can receive pushes.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Reminder', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Reminder'
  const options = {
    body: data.body || '',
    tag: data.tag || undefined, // collapses duplicates for the same reminder+day
    renotify: !!data.tag,
    icon: '/logo-small.svg',
    badge: '/logo-small.svg',
    data: { url: data.url || '/' },
    // A slight vibration so it's felt on mobile.
    vibrate: [80, 40, 80],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Focus an existing tab if one is open, else open a new one.
        for (const client of clients) {
          if ('focus' in client) {
            client.navigate(target).catch(() => {})
            return client.focus()
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target)
      }),
  )
})
