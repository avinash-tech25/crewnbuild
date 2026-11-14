/**
 * A system notification for a job request that arrives while the dashboard tab
 * is hidden. It uses the browser's own Notification API -- no service worker, no
 * push server, no second delivery channel: the request still comes over the
 * dashboard's existing socket, this only makes it visible outside the tab.
 *
 * Permission is asked only from a real tap (the Enable sound button), only where
 * the browser supports it, and only on a secure page (HTTPS or localhost); a
 * plain-HTTP address on the local network has no notifications at all. Nothing
 * here can make a locked phone or a suspended browser ring.
 */

function api() {
  if (typeof window === 'undefined') return null
  if (!('Notification' in window) || !window.isSecureContext) return null
  return window.Notification
}

export function jobNotificationsSupported() {
  return api() !== null
}

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function jobNotificationPermission() {
  const Notification = api()
  return Notification ? Notification.permission : 'unsupported'
}

/** Call from a click/tap only. Never asks again once answered. */
export async function requestJobNotificationPermission() {
  const Notification = api()
  if (!Notification) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

/** One notification for one request, only while the tab is hidden. Returns whether one was shown. */
export function showJobNotification(offer) {
  const Notification = api()
  if (!Notification || Notification.permission !== 'granted') return false
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return false
  try {
    const note = new Notification('New job request', {
      body: offer?.service_name ? `${offer.service_name} - waiting for your answer` : 'A customer is waiting for your answer',
      // The same booking replaces, never stacks, should it ever be shown twice.
      tag: `job-${offer?.booking_id}`,
    })
    note.onclick = () => {
      window.focus()
      note.close()
    }
    return true
  } catch {
    return false
  }
}
