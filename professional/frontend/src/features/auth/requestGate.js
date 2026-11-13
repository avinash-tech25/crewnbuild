// One code request at a time. A React state flag is only seen after the next
// render, so two clicks before it can both pass it; this answers at once. Every
// message is billed and counted against the number's hourly limit.
export function requestGate() {
  let busy = false
  return {
    enter() {
      if (busy) return false
      busy = true
      return true
    },
    leave() {
      busy = false
    },
  }
}
