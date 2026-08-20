import type { SupabaseClient } from '@supabase/supabase-js'

export const DEFAULT_BASIC_DAILY_ROUTINE_LIMIT = 2
export const DEFAULT_DAILY_WORKOUT_LIMIT = 2

// The only keys /api/admin/config will read or write. Anything else is rejected
// rather than written straight through, so the panel cannot be used to set
// arbitrary rows in app_config.
export const EDITABLE_CONFIG_FIELDS = [
  {
    key: 'basic_daily_routine_limit',
    label: 'Basic Daily Routine Limit',
    hint: 'Routines a Basic user can generate per day.',
    fallback: DEFAULT_BASIC_DAILY_ROUTINE_LIMIT,
  },
  {
    key: 'daily_workout_limit',
    label: 'Daily Workout Limit',
    hint: 'Completed workouts that count towards daily stats.',
    fallback: DEFAULT_DAILY_WORKOUT_LIMIT,
  },
] as const

export type EditableConfigKey = typeof EDITABLE_CONFIG_FIELDS[number]['key']

export type AppConfigValues = Record<EditableConfigKey, number>

export function isEditableConfigKey(key: unknown): key is EditableConfigKey {
  return EDITABLE_CONFIG_FIELDS.some((field) => field.key === key)
}

function parsePositiveInteger(value: string | null | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// A missing app_config table or row must leave callers on the documented
// default rather than failing the request that needed the limit.
async function readPositiveIntegerConfig(supabase: SupabaseClient, key: EditableConfigKey, fallback: number) {
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', key)
    .maybeSingle<{ value?: string | null }>()

  if (error) {
    return fallback
  }

  return parsePositiveInteger(data?.value, fallback)
}

export async function readBasicDailyRoutineLimit(supabase: SupabaseClient) {
  return readPositiveIntegerConfig(supabase, 'basic_daily_routine_limit', DEFAULT_BASIC_DAILY_ROUTINE_LIMIT)
}

export async function readDailyWorkoutLimit(supabase: SupabaseClient) {
  return readPositiveIntegerConfig(supabase, 'daily_workout_limit', DEFAULT_DAILY_WORKOUT_LIMIT)
}

export async function readAppConfigValues(supabase: SupabaseClient): Promise<AppConfigValues> {
  const entries = await Promise.all(
    EDITABLE_CONFIG_FIELDS.map(async (field) => [
      field.key,
      await readPositiveIntegerConfig(supabase, field.key, field.fallback),
    ] as const),
  )

  return Object.fromEntries(entries) as AppConfigValues
}
