/**
 * The one place that decides which picture stands for a person.
 *
 * The rule, and the only one any caller needs:
 *
 *     the user's own uploaded image  ->  use it
 *     otherwise                      ->  the local avatar for their role
 *     role unknown                   ->  the neutral local avatar
 *
 * Because every caller goes through here, one person looks the same wherever
 * their name appears: their own dashboard, a request list somebody else is
 * reading, a conversation, a member list. Before this, each screen decided for
 * itself and the same account showed a photo in one place, initials in another
 * and a role icon in a third.
 *
 * The defaults are static files in `public/avatars/`. They are never uploaded
 * to S3, never written to the database and never fetched from a third party, so
 * a person without a photograph costs no request beyond the app's own assets.
 *
 * ON GENDER
 *
 * `users` has no gender column, no schema returns one and nothing in the
 * frontend carries one. Obtaining it would mean a new column and a migration,
 * which this task forbids -- so every default here is the role's neutral
 * figure, and nobody's gender is guessed from their name.
 */
import { imageUrl } from '../api/apiClient.js'

const BASE = '/avatars'

// Keyed by the role values the application actually uses (users.role).
// Each role's figure: the House Owner in a shirt, the Builder and the Site
// Engineer in a hard hat and safety vest, the Supplier in a cap and overalls.
const BY_ROLE = {
  OWNER: `${BASE}/owner.webp`,
  CONTRACTOR: `${BASE}/contractor.webp`,
  BUILDER: `${BASE}/contractor.webp`,
  ENGINEER: `${BASE}/engineer.webp`,
  SUPPLIER: `${BASE}/supplier.webp`,
}

export const NEUTRAL_AVATAR = `${BASE}/neutral.svg`

/**
 * Where an uploaded picture is found on the objects the API already returns.
 * Ordered by how specific each one is to the person themselves.
 *
 * `profile_logo_url` is last on purpose: it is a company or store mark, and it
 * stands in for a person only on the payloads that have always used it that
 * way. Nothing here is invented -- every name is a field the backend sends
 * today.
 */
const IMAGE_FIELDS = ['profile_image_url', 'profileImageUrl', 'avatar_url', 'avatarUrl', 'profile_logo_url']

/**
 * Where that person's role is found. Several payloads name it differently
 * (`type` on the supplier's client list, `sender_role` on a request,
 * `profile_role` on a request profile) and a value is accepted only when it is
 * a role this app knows, so an unrelated `type` can never be mistaken for one.
 */
const ROLE_FIELDS = ['role', 'profile_role', 'sender_role', 'user_role', 'requester_role', 'type']

/** The local default for a role. Neutral for an admin, a blank or anything else. */
export function defaultAvatarFor(role) {
  return BY_ROLE[String(role || '').toUpperCase()] || NEUTRAL_AVATAR
}

/** True when this string names a role the app has an avatar for. */
export function isKnownRole(role) {
  return Boolean(BY_ROLE[String(role || '').toUpperCase()])
}

/**
 * The primitive: an already-resolved URL wins, otherwise the role's default.
 * Use it when the caller has run `imageUrl()` itself, or is holding a local
 * `blob:` preview of a file being uploaded.
 */
export function avatarSrc(uploaded, role) {
  const own = String(uploaded || '').trim()
  return own || defaultAvatarFor(role)
}

/**
 * The same rule for a raw stored path (`/files/…`), which still has to go
 * through `imageUrl()` to become fetchable. Existing upload and storage
 * behaviour is untouched -- this only decides what to show when there is
 * nothing stored.
 */
export function avatarFromPath(path, role) {
  const stored = String(path || '').trim()
  return stored ? imageUrl(stored) : defaultAvatarFor(role)
}

/** The first field on `user` that actually holds a stored image path. */
function uploadedImageOf(user) {
  for (const field of IMAGE_FIELDS) {
    const value = user?.[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** The first field on `user` that holds a role this app recognises. */
function roleOf(user) {
  for (const field of ROLE_FIELDS) {
    if (isKnownRole(user?.[field])) return user[field]
  }
  return ''
}

/**
 * The avatar for one person, taken from that person's own record.
 *
 * Pass the same object the name beside the avatar came from, so the two can
 * never drift apart -- a request from a House Owner shows the House Owner,
 * whoever happens to be logged in and reading it.
 *
 * `fallbackRole` covers the lists whose rows carry no role because the whole
 * list is one role already (a project's site engineers, a builder's suppliers).
 * It is only consulted when the record itself names no role.
 */
export function userAvatarSrc(user, fallbackRole = null) {
  return avatarFromPath(uploadedImageOf(user), roleOf(user) || fallbackRole)
}
