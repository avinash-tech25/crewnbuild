// The country a Global Super Admin is currently looking at. Held here rather than
// threaded through every screen, so an admin call cannot be written that quietly
// ignores it. Set by the country switch in the admin console; empty for everybody else.
let viewingCountry = ''

export function setViewingCountry(country) {
  viewingCountry = country || ''
}

export function scoped(params = {}) {
  return viewingCountry ? { ...params, country: viewingCountry } : params
}
