import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import PersonalistaClient from './PersonalistaClient'

function isoDateOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function fullName(user: any) {
  return `${user?.meno || ''} ${user?.priezvisko || ''}`.trim()
}

export default async function PersonalistaPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const { data: memberships, error } = await supabaseServer
    .from('group_members')
    .select(`
      id,
      user_id,
      group_id,
      role,
      created_at,
      groups (
        id,
        name
      ),
      users (
        id,
        meno,
        priezvisko,
        email,
        telefon,
        typ_stravy
      )
    `)
    .order('created_at', { ascending: true })

  if (error) {
    return (
      <main style={styles.page}>
        <section style={styles.errorBox}>
          {error.message}
        </section>
      </main>
    )
  }

  const allMemberships = memberships || []

  const { data: globalRoles } = await supabaseServer
    .from('app_user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('active', true)

  const isGlobalPersonalista = (globalRoles || []).some((item: any) => {
    const role = String(item.role || '').toUpperCase()
    return role === 'ADMIN' || role === 'PERSONALISTA'
  })

  const myManageableGroupIds = allMemberships
    .filter((membership: any) => {
      const role = String(membership.role || '').toUpperCase()
      return membership.user_id === user.id && (role === 'MANAGER' || role === 'OWNER')
    })
    .map((membership: any) => membership.group_id)

  const manageableGroupIdSet = new Set(myManageableGroupIds)

  const visibleMemberships = allMemberships.filter((membership: any) => {
    if (isGlobalPersonalista) return true

    return manageableGroupIdSet.has(membership.group_id)
  })

  const groupsById = new Map<string, any>()

  visibleMemberships.forEach((membership: any) => {
    const group = Array.isArray(membership.groups)
      ? membership.groups[0]
      : membership.groups

    if (group?.id) {
      groupsById.set(group.id, {
        id: group.id,
        name: group.name || 'Skupina bez nazvu'
      })
    }
  })

  const userIds = Array.from(
    new Set(visibleMemberships.map((membership: any) => membership.user_id).filter(Boolean))
  )

  const fromDate = isoDateOffset(0)
  const toDate = isoDateOffset(13)

  let qrRows: any[] = []
  let entitlementRows: any[] = []

  if (userIds.length > 0) {
    const { data: qrData } = await supabaseServer
      .from('user_qr_codes')
      .select('user_id, active')
      .in('user_id', userIds)

    qrRows = qrData || []

    const { data: entitlementData } = await supabaseServer
      .from('user_food_entitlements')
      .select('user_id, datum, obed, vecera')
      .in('user_id', userIds)
      .gte('datum', fromDate)
      .lte('datum', toDate)

    entitlementRows = entitlementData || []
  }

  const activeQrByUserId = new Map<string, number>()

  qrRows.forEach((row: any) => {
    if (!row.active) return

    activeQrByUserId.set(
      row.user_id,
      (activeQrByUserId.get(row.user_id) || 0) + 1
    )
  })

  const entitlementsByUserId = new Map<string, any[]>()

  entitlementRows.forEach((row: any) => {
    const list = entitlementsByUserId.get(row.user_id) || []
    list.push(row)
    entitlementsByUserId.set(row.user_id, list)
  })

  const personMap = new Map<string, any>()

  visibleMemberships.forEach((membership: any) => {
    const memberUser = Array.isArray(membership.users)
      ? membership.users[0]
      : membership.users

    const group = groupsById.get(membership.group_id)
    const current = personMap.get(membership.user_id)
    const groupItem = {
      id: membership.group_id,
      name: group?.name || 'Skupina bez nazvu',
      role: String(membership.role || '').toUpperCase()
    }

    if (current) {
      current.groups.push(groupItem)
      return
    }

    const rows = entitlementsByUserId.get(membership.user_id) || []
    const mealClaims = rows.reduce((sum, row) => {
      return sum + (row.obed ? 1 : 0) + (row.vecera ? 1 : 0)
    }, 0)

    personMap.set(membership.user_id, {
      id: membership.user_id,
      fullName: fullName(memberUser) || memberUser?.email || 'Bez mena',
      meno: memberUser?.meno || '',
      priezvisko: memberUser?.priezvisko || '',
      email: memberUser?.email || '',
      telefon: memberUser?.telefon || '',
      typStravy: memberUser?.typ_stravy || '',
      activeQrCount: activeQrByUserId.get(membership.user_id) || 0,
      entitlementDays: rows.length,
      mealClaims,
      groups: [groupItem]
    })
  })

  const groups = Array.from(groupsById.values()).sort((a, b) => {
    return a.name.localeCompare(b.name, 'sk')
  })

  const people = Array.from(personMap.values()).sort((a, b) => {
    const aManager = a.groups.some((group: any) => group.role === 'MANAGER' || group.role === 'OWNER')
    const bManager = b.groups.some((group: any) => group.role === 'MANAGER' || group.role === 'OWNER')

    if (aManager !== bManager) return aManager ? -1 : 1

    return a.fullName.localeCompare(b.fullName, 'sk')
  })

  return (
    <PersonalistaClient
      people={people}
      groups={groups}
      fromDate={fromDate}
      toDate={toDate}
      canManage={isGlobalPersonalista || myManageableGroupIds.length > 0}
    />
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 12,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    fontWeight: 850
  }
}
