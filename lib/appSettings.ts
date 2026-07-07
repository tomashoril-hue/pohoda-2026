import { supabaseServer } from '@/lib/supabaseServer'

export const LEGACY_FOOD_GROUPS_SETTING_KEY = 'legacy_food_groups_enabled'
export const LEGACY_BULK_ISSUE_SETTING_KEY = 'legacy_bulk_issue_enabled'
export const PUBLIC_REGISTRATION_SETTING_KEY = 'public_registration_enabled'

export async function getBooleanAppSetting(key: string, fallback: boolean) {
  const { data, error } = await supabaseServer
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return fallback
    throw error
  }

  if (typeof data?.value === 'boolean') return data.value
  if (typeof data?.value === 'string') return data.value.toLowerCase() === 'true'

  return fallback
}

export async function getLegacyFoodGroupsEnabled() {
  return getBooleanAppSetting(LEGACY_FOOD_GROUPS_SETTING_KEY, false)
}

export async function setLegacyFoodGroupsEnabled(enabled: boolean, updatedBy: string) {
  const { error } = await supabaseServer
    .from('app_settings')
    .upsert({
      key: LEGACY_FOOD_GROUPS_SETTING_KEY,
      value: enabled,
      updated_by: updatedBy || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' })

  if (error) throw error
}

export async function getLegacyBulkIssueEnabled() {
  return getBooleanAppSetting(LEGACY_BULK_ISSUE_SETTING_KEY, false)
}

export async function setLegacyBulkIssueEnabled(enabled: boolean, updatedBy: string) {
  const { error } = await supabaseServer
    .from('app_settings')
    .upsert({
      key: LEGACY_BULK_ISSUE_SETTING_KEY,
      value: enabled,
      updated_by: updatedBy || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' })

  if (error) throw error
}

export async function getPublicRegistrationEnabled() {
  return getBooleanAppSetting(PUBLIC_REGISTRATION_SETTING_KEY, false)
}

export async function setPublicRegistrationEnabled(enabled: boolean, updatedBy: string) {
  const { error } = await supabaseServer
    .from('app_settings')
    .upsert({
      key: PUBLIC_REGISTRATION_SETTING_KEY,
      value: enabled,
      updated_by: updatedBy || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' })

  if (error) throw error
}
