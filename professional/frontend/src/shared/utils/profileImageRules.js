// What a profile photo, company logo or store logo may be. These mirror the
// backend's own rules in upload_service.py (MAX_UPLOAD_BYTES and the image
// MIME types), which still decide; checking here first only means a wrong file
// is refused at once, in the user's language, instead of after it has been
// sent in full.

export const PROFILE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const PROFILE_IMAGE_ACCEPT = PROFILE_IMAGE_TYPES.join(',')
export const PROFILE_IMAGE_MAX_MB = 10
const PROFILE_IMAGE_MAX_BYTES = PROFILE_IMAGE_MAX_MB * 1024 * 1024

/**
 * Throws when `file` cannot be a profile image. The error carries
 * `userMessage`, which `apiErrorMessage` shows in place of a server message.
 */
export function assertProfileImage(file, t) {
  let message = ''
  if (!PROFILE_IMAGE_TYPES.includes(file?.type)) {
    message = t('ui.profileImage.badType')
  } else if (file.size > PROFILE_IMAGE_MAX_BYTES) {
    // Rounded up, so a file just over the limit never reads as "10.0 MB".
    const sizeMb = (Math.ceil((file.size / (1024 * 1024)) * 10) / 10).toFixed(1)
    message = t('ui.profileImage.tooLarge', { size: sizeMb, mb: PROFILE_IMAGE_MAX_MB })
  }
  if (message) {
    const error = new Error(message)
    error.userMessage = message
    throw error
  }
}
