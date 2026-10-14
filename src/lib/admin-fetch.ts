import { createClient } from '@/lib/supabase/client'

async function requestWithSession(input: RequestInfo | URL, init: RequestInit, accessToken: string) {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)

  return fetch(input, {
    ...init,
    headers,
  })
}

// Admin pages can remain open for a long time. Resolve the current session for
// every request so Supabase can provide an auto-refreshed access token instead
// of reusing the token that was present when the page first loaded.
export async function adminFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const supabase = createClient()
  const { data: { session }, error } = await supabase.auth.getSession()

  if (error || !session?.access_token) {
    throw new Error('Admin request is not authenticated.')
  }

  const response = await requestWithSession(input, init, session.access_token)
  if (response.status !== 401) return response

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError || !refreshed.session?.access_token) return response

  return requestWithSession(input, init, refreshed.session.access_token)
}
