// The owner signs in with an Owner ID, never an email address. Supabase Auth is
// email-based underneath, so the ID is mapped onto a reserved domain that is
// never displayed and never receives mail. Keeping a real Supabase account
// behind the ID is what lets requireAdminAccess() in src/lib/supabase/admin.ts
// keep verifying every admin API call server-side.
export const OWNER_EMAIL_DOMAIN = 'moveandgroove.local'

// Matches the account created by database/supabase-grant-admin.sql.
export const DEFAULT_OWNER_ID = 'owner'

export function ownerIdToEmail(rawOwnerId: string) {
  const ownerId = rawOwnerId.trim().toLowerCase()
  if (!ownerId) {
    return ''
  }

  // An address still works, so an owner granted access by email before the
  // switch to Owner IDs is not locked out.
  if (ownerId.includes('@')) {
    return ownerId
  }

  return `${ownerId}@${OWNER_EMAIL_DOMAIN}`
}

// Reverse of the above, for showing who is signed in without leaking the
// internal domain into the UI.
export function emailToOwnerId(email: string | null | undefined) {
  if (!email) {
    return 'unknown'
  }

  const suffix = `@${OWNER_EMAIL_DOMAIN}`
  return email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length) : email
}
