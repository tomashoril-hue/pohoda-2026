import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getGlobalAccess } from '@/lib/globalRoles'
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

async function fetchAllMemberships() {
  const rows: any[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseServer
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
          typ_stravy,
          aktivny
        )
      `)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) return { rows, error }

    rows.push(...(data || []))

    if (!data || data.length < pageSize) return { rows, error: null }
  }
}

async function fetchAllUsers() {
  const rows: any[] = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseServer
      .from('users')
      .select('id, meno, priezvisko, email, telefon, typ_stravy, aktivny')
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)

    if (error) return { rows, error }

    rows.push(...(data || []))

    if (!data || data.length < pageSize) return { rows, error: null }
  }
}

export default async function PersonalistaPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const { rows: memberships, error } = await fetchAllMemberships()

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

  const globalAccess = await getGlobalAccess(user.id)
  const isGlobalPersonalista = globalAccess.canUsePersonalista

  if (!isGlobalPersonalista) {
    redirect('/dashboard')
  }

  const myManageableGroupIds = allMemberships
    .filter((membership: any) => {
      const role = String(membership.role || '').toUpperCase()
      return membership.user_id === user.id && role === 'MANAGER'
    })
    .map((membership: any) => membership.group_id)

  const manageableGroupIdSet = new Set(myManageableGroupIds)

  const visibleMemberships = allMemberships.filter((membership: any) => {
    if (isGlobalPersonalista) return true

    return manageableGroupIdSet.has(membership.group_id)
  })

  let allVisibleUsers: any[] = []

  if (isGlobalPersonalista) {
    const { rows: usersData } = await fetchAllUsers()

    allVisibleUsers = usersData || []
  }

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

  if (isGlobalPersonalista) {
    const { data: allGroupsData } = await supabaseServer
      .from('groups')
      .select('id, name')
      .order('name', { ascending: true })

    ;(allGroupsData || []).forEach((group: any) => {
      if (!group?.id) return

      groupsById.set(group.id, {
        id: group.id,
        name: group.name || 'Skupina bez nazvu'
      })
    })
  }

  const membershipUserIds = visibleMemberships
    .map((membership: any) => membership.user_id)
    .filter(Boolean)

  const globalUserIds = allVisibleUsers
    .map((item: any) => item.id)
    .filter(Boolean)

  const userIds = Array.from(new Set([
    ...membershipUserIds,
    ...globalUserIds
  ]))

  const fromDate = isoDateOffset(0)
  const toDate = isoDateOffset(13)

  let qrRows: any[] = []
  let nfcRows: any[] = []
  let roleRows: any[] = []
  let entitlementRows: any[] = []

  if (userIds.length > 0) {
    const { data: qrData } = await supabaseServer
      .from('user_qr_codes')
      .select('user_id, active')
      .in('user_id', userIds)

    qrRows = qrData || []

    const { data: nfcData } = await supabaseServer
      .from('personnel_nfc_tokens')
      .select('user_id, active')
      .in('user_id', userIds)

    nfcRows = nfcData || []

    const { data: roleData } = await supabaseServer
      .from('app_user_roles')
      .select('user_id, role, active')
      .in('user_id', userIds)

    roleRows = roleData || []

    const { data: entitlementData } = await supabaseServer
      .from('user_food_entitlements')
      .select('user_id, datum, obed, vecera')
      .in('user_id', userIds)
      .gte('datum', fromDate)
      .lte('datum', toDate)

    entitlementRows = entitlementData || []
  }

  const activeQrByUserId = new Map<string, number>()
  const activeNfcByUserId = new Map<string, number>()
  const globalRolesByUserId = new Map<string, string[]>()

  qrRows.forEach((row: any) => {
    if (!row.active) return

    activeQrByUserId.set(
      row.user_id,
      (activeQrByUserId.get(row.user_id) || 0) + 1
    )
  })

  nfcRows.forEach((row: any) => {
    if (!row.active) return

    activeNfcByUserId.set(
      row.user_id,
      (activeNfcByUserId.get(row.user_id) || 0) + 1
    )
  })

  roleRows.forEach((row: any) => {
    if (!row.active) return

    const list = globalRolesByUserId.get(row.user_id) || []
    list.push(String(row.role || '').toUpperCase())
    globalRolesByUserId.set(row.user_id, list)
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
    const lunchClaims = rows.filter(row => row.obed).length
    const dinnerClaims = rows.filter(row => row.vecera).length
    const mealClaims = lunchClaims + dinnerClaims

    personMap.set(membership.user_id, {
      id: membership.user_id,
      fullName: fullName(memberUser) || memberUser?.email || 'Bez mena',
      meno: memberUser?.meno || '',
      priezvisko: memberUser?.priezvisko || '',
      email: memberUser?.email || '',
      telefon: memberUser?.telefon || '',
      typStravy: memberUser?.typ_stravy || '',
      aktivny: memberUser?.aktivny || 'ANO',
      activeQrCount: activeQrByUserId.get(membership.user_id) || 0,
      activeNfcCount: activeNfcByUserId.get(membership.user_id) || 0,
      globalRoles: globalRolesByUserId.get(membership.user_id) || [],
      entitlementDays: rows.length,
      lunchClaims,
      dinnerClaims,
      mealClaims,
      entitlements: rows
        .map(row => ({
          datum: row.datum,
          obed: !!row.obed,
          vecera: !!row.vecera
        }))
        .sort((a, b) => String(a.datum).localeCompare(String(b.datum))),
      groups: [groupItem]
    })
  })

  if (isGlobalPersonalista) {
    allVisibleUsers.forEach((profile: any) => {
      if (personMap.has(profile.id)) return

      const rows = entitlementsByUserId.get(profile.id) || []
      const lunchClaims = rows.filter(row => row.obed).length
      const dinnerClaims = rows.filter(row => row.vecera).length

      personMap.set(profile.id, {
        id: profile.id,
        fullName: fullName(profile) || profile.email || 'Bez mena',
        meno: profile.meno || '',
        priezvisko: profile.priezvisko || '',
        email: profile.email || '',
        telefon: profile.telefon || '',
        typStravy: profile.typ_stravy || '',
        aktivny: profile.aktivny || 'ANO',
        activeQrCount: activeQrByUserId.get(profile.id) || 0,
        activeNfcCount: activeNfcByUserId.get(profile.id) || 0,
        globalRoles: globalRolesByUserId.get(profile.id) || [],
        entitlementDays: rows.length,
        lunchClaims,
        dinnerClaims,
        mealClaims: lunchClaims + dinnerClaims,
        entitlements: rows
          .map(row => ({
            datum: row.datum,
            obed: !!row.obed,
            vecera: !!row.vecera
          }))
          .sort((a, b) => String(a.datum).localeCompare(String(b.datum))),
        groups: []
      })
    })
  }

  const groups = Array.from(groupsById.values()).sort((a, b) => {
    return a.name.localeCompare(b.name, 'sk')
  })

  const people = Array.from(personMap.values()).sort((a, b) => {
    const aManager = a.groups.some((group: any) => group.role === 'MANAGER')
    const bManager = b.groups.some((group: any) => group.role === 'MANAGER')

    if (aManager !== bManager) return aManager ? -1 : 1

    return a.fullName.localeCompare(b.fullName, 'sk')
  })

  return (
    <PersonalistaClient
      people={people}
      groups={groups}
      fromDate={fromDate}
      toDate={toDate}
      canManage={isGlobalPersonalista}
      canAssignSensitiveRoles={globalAccess.isAdmin}
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
