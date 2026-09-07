import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

let browserClient: SupabaseClient | null = null

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)

export function isInvalidRefreshTokenError(message?: string | null) {
  const normalized = message?.toLowerCase() ?? ''

  return (
    normalized.includes('invalid refresh token') ||
    normalized.includes('refresh token not found') ||
    normalized.includes('jwt expired')
  )
}

export function createClient() {
  if (browserClient) {
    return browserClient
  }

  // A missing local .env file should not make the public site crash. Requests
  // that require Supabase remain unavailable until real credentials are added.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://offline.supabase.invalid'
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'offline-anon-key'

  browserClient = createSupabaseClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      auth: {
        autoRefreshToken: isSupabaseConfigured,
        detectSessionInUrl: true,
        flowType: 'implicit',
        persistSession: isSupabaseConfigured,
      },
    }
  )

  return browserClient
}
