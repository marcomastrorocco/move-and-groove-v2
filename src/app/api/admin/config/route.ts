import { NextRequest, NextResponse } from 'next/server'
import { EDITABLE_CONFIG_FIELDS, isEditableConfigKey, readAppConfigValues } from '@/lib/app-config'
import { requireAdminAccess } from '@/lib/supabase/admin'

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error'
  const status = message.includes('Admin') || message.includes('authenticated') || message.includes('token') ? 401 : 500
  return NextResponse.json({ error: message }, { status })
}

export async function GET(req: NextRequest) {
  try {
    const { serviceClient } = await requireAdminAccess(req)
    return NextResponse.json({ config: await readAppConfigValues(serviceClient as never) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { serviceClient } = await requireAdminAccess(req)
    const body = await req.json() as { key?: string; value?: number | string | null }
    const key = body.key ?? EDITABLE_CONFIG_FIELDS[0].key

    if (!isEditableConfigKey(key)) {
      return NextResponse.json({ error: 'Unknown config key.' }, { status: 400 })
    }

    const nextValue = Number.parseInt(String(body.value), 10)

    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      return NextResponse.json({ error: 'Invalid config value.' }, { status: 400 })
    }

    const { error } = await serviceClient
      .from('app_config')
      .upsert([{
        key,
        value: String(nextValue),
        updated_at: new Date().toISOString(),
      }], {
        onConflict: 'key',
      })

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({ key, value: nextValue })
  } catch (error) {
    return errorResponse(error)
  }
}
