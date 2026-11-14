// A profile document is stored as "<Type>: <url>" -- the form Complete Profile and
// the builder's Profile Settings write, and the backend reads (document_type_labels,
// the admin verification queue, the /files access check) -- or as a bare "<url>"
// from an older upload. Only the reference is ever stored; the file itself stays
// in storage behind /files/<id>.

/** Split a stored entry into its type ('' for an older bare entry) and its url. */
export function splitDocumentEntry(entry) {
  const text = String(entry || '').trim()
  const separatorIndex = text.indexOf(': ')
  if (separatorIndex > 0 && !text.startsWith('/') && !text.startsWith('http')) {
    return { type: text.slice(0, separatorIndex).trim(), url: text.slice(separatorIndex + 2).trim() }
  }
  return { type: '', url: text }
}

/** The entry saved for an upload: "<Type>: <url>", or the bare url when no type is known. */
export function typedDocumentEntry(type, url) {
  const cleanUrl = String(url || '').trim()
  if (!cleanUrl) return ''
  const cleanType = String(type || '').trim()
  return cleanType ? `${cleanType}: ${cleanUrl}` : cleanUrl
}

/** The file reference inside an entry, typed or bare (what a link should open). */
export function documentFileUrl(entry) {
  return splitDocumentEntry(entry).url
}
