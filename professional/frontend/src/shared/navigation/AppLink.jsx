import { Link, NavLink, useInRouterContext } from 'react-router-dom'

/*
 * Links to the app's own pages that navigate inside the single-page app (no full reload).
 *
 * A plain <a href="/login"> reloads the whole application: the bundle, the session check
 * and the loading screen all run again. These render react-router's Link / NavLink for an
 * app path, and fall back to a plain anchor for anything the router does not handle:
 * in-page hashes ("#roles"), a hash on another page ("/#how", which needs the browser's own
 * scroll-to-anchor), external URLs, and a render outside any router (a component test
 * that mounts the piece on its own).
 */
function isAppPath(href) {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') && !href.includes('#')
}

export function AppLink({ href, ...props }) {
  const inRouter = useInRouterContext()
  if (inRouter && isAppPath(href)) return <Link to={href} {...props} />
  return <a href={href} {...props} />
}

/*
 * As AppLink, and marks itself aria-current="page" while its page is the one shown
 * (NavLink). `className` may be a function of { isActive }, as with NavLink; outside a
 * router `active` (when given) decides instead.
 */
export function AppNavLink({ href, className, active, end, ...props }) {
  const inRouter = useInRouterContext()
  if (inRouter && isAppPath(href)) {
    return <NavLink to={href} end={end} className={className} {...props} />
  }
  const isActive = Boolean(active)
  return (
    <a
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={typeof className === 'function' ? className({ isActive }) : className}
      {...props}
    />
  )
}

export default AppLink
