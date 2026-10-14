import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import 'server-only'

function readEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function readServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
}

export function createServiceRoleClient() {
  const serviceRoleKey = readServiceRoleKey()
  if (!serviceRoleKey) {
    throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY')
  }

  return createClient(
    readEnv('NEXT_PUBLIC_SUPABASE_URL'),
    serviceRoleKey,
  )
}

export function createAuthClient(accessToken: string) {
  return createClient(
    readEnv('NEXT_PUBLIC_SUPABASE_URL'),
    readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    },
  )
}

export function createAccessTokenClient(accessToken: string) {
  return createClient(
    readEnv('NEXT_PUBLIC_SUPABASE_URL'),
    readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      accessToken: async () => accessToken,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    },
  )
}

export async function requireAdminAccess(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || ''
  const accessToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : ''

  if (!accessToken) {
    throw new Error('Missing admin access token.')
  }

  const authClient = createAuthClient(accessToken)
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(accessToken)

  if (authError || !user) {
    throw new Error('Admin request is not authenticated.')
  }

  const serviceClient = createServiceRoleClient()
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    throw new Error(profileError.message)
  }

  if (!profile?.is_admin) {
    throw new Error('Admin access required.')
  }

  return {
    accessToken,
    authClient,
    serviceClient,
    user,
  }
}
