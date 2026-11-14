// Whether an account is signed in on this page, for code outside React (the live
// sockets). The store keeps it current (app/store.js); nothing is kept in browser
// storage. Sockets authenticate with the session cookie on the handshake; this only
// decides whether there is anyone to connect as.
let signedIn = false
const signOutListeners = new Set()

export function noteSignedIn(now) {
  const was = signedIn
  signedIn = Boolean(now)
  if (was && !signedIn) signOutListeners.forEach((listener) => listener())
}

export function hasSignedInUser() {
  return signedIn
}

/** Called each time the signed-in account goes away; returns the unsubscribe. */
export function onSignedOut(listener) {
  signOutListeners.add(listener)
  return () => signOutListeners.delete(listener)
}
