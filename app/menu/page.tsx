import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
import { loadMenuSelectionData } from '@/lib/menuData'
import MenuClient from './MenuClient'

export default async function MenuPage() {
  const user = await getCurrentUser()

  if (!user) redirect('/')

  const access = await getGlobalAccess(user.id)
  const isOnlyMenuKiosk =
    access.isMenuKiosk &&
    access.roles.length > 0 &&
    access.roles.every(role => role === 'MENU_KIOSK')

  if (isOnlyMenuKiosk) {
    redirect('/dashboard/vyber-stravy-kiosk')
  }

  const menuData = await loadMenuSelectionData(user.id)

  return (
    <MenuClient
      userId={user.id}
      today={menuData.today}
      defaultFood={user.typ_stravy || null}
      menu={menuData.menu}
      selections={menuData.selections}
      deadlines={menuData.deadlines}
    />
  )
}
