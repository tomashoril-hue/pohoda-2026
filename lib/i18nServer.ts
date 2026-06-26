import { cookies } from 'next/headers'
import { APP_LANGUAGE_COOKIE, normalizeAppLanguage, type AppLanguage } from './i18n'

export async function requestLanguage(user?: any): Promise<AppLanguage> {
  const userLanguage = user?.app_language || user?.language
  if (userLanguage) return normalizeAppLanguage(userLanguage)

  const cookieStore = await cookies()
  return normalizeAppLanguage(cookieStore.get(APP_LANGUAGE_COOKIE)?.value)
}
