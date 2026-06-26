import { requestLanguage } from '@/lib/i18nServer'
import RegisterClient from './RegisterClient'

export default async function RegisterPage() {
  const language = await requestLanguage()

  return <RegisterClient language={language} />
}
