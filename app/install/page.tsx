import type { Metadata } from 'next'
import InstallClient from './InstallClient'

export const metadata: Metadata = {
  title: 'Nainštaluj si POHODA Pass',
  description: 'Návod na pridanie aplikácie POHODA Pass na plochu telefónu.'
}

export default function InstallPage() {
  return <InstallClient />
}
