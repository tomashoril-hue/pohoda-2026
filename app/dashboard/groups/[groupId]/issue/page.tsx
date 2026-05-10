import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { supabaseServer } from '@/lib/supabaseServer'
import GroupIssueClient from '../../../group/issue/GroupIssueClient'

function todayIsoDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function addDaysIso(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function entitlementStatus(
  entitlement: any,
  typJedla: string
): 'YES' | 'NO' | 'UNKNOWN' {
  if (!entitlement) return 'UNKNOWN'

  if (typJedla === 'OBED') {
    return entitlement.obed ? 'YES' : 'NO'
  }

  if (typJedla === 'VECERA') {
    return entitlement.vecera ? 'YES' : 'NO'
  }

  return 'UNKNOWN'
}

export default async function GroupIssuePage({
  params
}: {
  params: Promise<{ groupId: string }>
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/')
  }

  const { groupId } = await params

  const { data: membership, error: membershipError } = await supabaseServer
    .from('group_members')
    .select(`
      group_id,
      role,
      groups (
        id,
        name
      )
    `)
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membershipError || !membership) {
    redirect('/dashboard/groups')
  }

  const role = String(membership.role || '').toUpperCase()

  if (role !== 'MANAGER' && role !== 'POVERENY' && role !== 'OWNER') {
    redirect(`/dashboard/groups/${groupId}`)
  }

  const group = Array.isArray(membership.groups)
    ? membership.groups[0]
    : membership.groups

  const { data: currentUserProfile } = await supabaseServer
    .from('users')
    .select('meno, priezvisko, email')
    .eq('id', user.id)
    .maybeSingle()

  const myName =
    `${currentUserProfile?.meno || ''} ${currentUserProfile?.priezvisko || ''}`.trim() ||
    currentUserProfile?.email ||
    user.email ||
    ''

  const { data: membersData } = await supabaseServer
    .from('group_members')
    .select(`
      user_id,
      role,
      created_at,
      users (
        id,
        meno,
        priezvisko,
        email,
        telefon,
        typ_stravy,
        qr_code
      )
    `)
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })

  const members = (membersData || []).map((member: any) => {
    const memberUser = Array.isArray(member.users)
      ? member.users[0]
      : member.users

    const fullName = `${memberUser?.meno || ''} ${memberUser?.priezvisko || ''}`.trim()

    return {
      userId: member.user_id,
      role: member.role,
      fullName: fullName || memberUser?.email || 'Bez mena',
      meno: memberUser?.meno || '',
      priezvisko: memberUser?.priezvisko || '',
      email: memberUser?.email || '',
      telefon: memberUser?.telefon || '',
      typStravy: memberUser?.typ_stravy || '',
      qrCode: memberUser?.qr_code || '',
      status: 'PLANNED',
      removeReason: null
    }
  })

  const memberRoleMap = new Map(
    members.map((member: any) => [member.userId, member.role])
  )

  const memberIdSet = new Set(
    members.map((member: any) => member.userId)
  )

  const { data: activeIssuesData } = await supabaseServer
    .from('hromadne_vydaje')
    .select(`
      id,
      datum,
      typ_jedla,
      status,
      valid_after,
      created_at
    `)
    .eq('group_id', groupId)
    .in('status', ['READY', 'WAITING'])
    .order('created_at', { ascending: false })

  const activeIssueIds = (activeIssuesData || []).map((issue: any) => issue.id)

  const groupUserIds = members.map((member: any) => member.userId).filter(Boolean)

  const dateList = Array.from(
    new Set([
      todayIsoDate(),
      addDaysIso(1),
      addDaysIso(2),
      addDaysIso(3),
      addDaysIso(4),
      addDaysIso(5),
      addDaysIso(6),
      addDaysIso(7),
      ...(activeIssuesData || []).map((issue: any) => issue.datum)
    ])
  )

  let entitlementRows: any[] = []

  if (groupUserIds.length > 0 && dateList.length > 0) {
    const { data: entitlementsData } = await supabaseServer
      .from('user_food_entitlements')
      .select('user_id, datum, obed, vecera')
      .in('user_id', groupUserIds)
      .in('datum', dateList)

    entitlementRows = entitlementsData || []
  }

  const entitlementMap = new Map(
    entitlementRows.map((row: any) => [
      `${row.user_id}|${row.datum}`,
      row
    ])
  )

  const getEntitlement = (userId: string, datum: string, typJedla: string) => {
    const row = entitlementMap.get(`${userId}|${datum}`)
    return entitlementStatus(row, typJedla)
  }

  const membersWithEntitlements = members.map((member: any) => {
    const entitlementsByDate: Record<string, any> = {}

    dateList.forEach(date => {
      const row = entitlementMap.get(`${member.userId}|${date}`)

      entitlementsByDate[date] = {
        OBED: entitlementStatus(row, 'OBED'),
        VECERA: entitlementStatus(row, 'VECERA')
      }
    })

    return {
      ...member,
      entitlementsByDate
    }
  })

  let otherIssueRows: any[] = []

  if (groupUserIds.length > 0) {
    const { data: otherItemsData } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .select(`
        id,
        user_id,
        hromadny_vydaj_id,
        hromadne_vydaje (
          id,
          group_id,
          datum,
          typ_jedla,
          status
        )
      `)
      .eq('status', 'PLANNED')
      .in('user_id', groupUserIds)

    otherIssueRows = (otherItemsData || []).filter((item: any) => {
      const issue = Array.isArray(item.hromadne_vydaje)
        ? item.hromadne_vydaje[0]
        : item.hromadne_vydaje

      return (
        issue &&
        issue.group_id !== groupId &&
        (issue.status === 'READY' || issue.status === 'WAITING')
      )
    })
  }

  const otherIssueGroupIds = Array.from(
    new Set(
      otherIssueRows
        .map((item: any) => {
          const issue = Array.isArray(item.hromadne_vydaje)
            ? item.hromadne_vydaje[0]
            : item.hromadne_vydaje

          return issue?.group_id
        })
        .filter(Boolean)
    )
  )

  let otherGroupNameMap = new Map<string, string>()

  if (otherIssueGroupIds.length > 0) {
    const { data: otherGroupsData } = await supabaseServer
      .from('groups')
      .select('id, name')
      .in('id', otherIssueGroupIds)

    otherGroupNameMap = new Map(
      (otherGroupsData || []).map((groupItem: any) => [
        groupItem.id,
        groupItem.name || 'Iná skupina'
      ])
    )
  }

  const conflictMap = new Map<string, any>()

  otherIssueRows.forEach((item: any) => {
    const issue = Array.isArray(item.hromadne_vydaje)
      ? item.hromadne_vydaje[0]
      : item.hromadne_vydaje

    if (!issue) return

    const key = `${item.user_id}|${issue.datum}|${issue.typ_jedla}`

    if (conflictMap.has(key)) return

    conflictMap.set(key, {
      issueId: issue.id,
      groupId: issue.group_id,
      groupName: otherGroupNameMap.get(issue.group_id) || 'Iná skupina',
      datum: issue.datum,
      typJedla: issue.typ_jedla,
      status: issue.status
    })
  })

  const membersWithAvailability = membersWithEntitlements.map((member: any) => {
    const conflictsByDate: Record<string, any> = {}
    const conflictsByKey: Record<string, any> = {}

    conflictMap.forEach((conflict, key) => {
      const [userId, date, meal] = key.split('|')

      if (userId === member.userId) {
        conflictsByKey[`${date}|${meal}`] = conflict
      }
    })

    dateList.forEach(date => {
      conflictsByDate[date] = {
        OBED: conflictMap.get(`${member.userId}|${date}|OBED`) || null,
        VECERA: conflictMap.get(`${member.userId}|${date}|VECERA`) || null
      }
    })

    return {
      ...member,
      conflictsByDate,
      conflictsByKey
    }
  })

  let activeIssueItems: any[] = []

  if (activeIssueIds.length > 0) {
    const { data: itemsData } = await supabaseServer
      .from('hromadny_vydaj_polozky')
      .select(`
        id,
        hromadny_vydaj_id,
        user_id,
        volba,
        status,
        source,
        remove_reason,
        removed_at
      `)
      .in('hromadny_vydaj_id', activeIssueIds)

    const rawItems = itemsData || []
    const userIds = Array.from(new Set(rawItems.map((item: any) => item.user_id).filter(Boolean)))

    let usersMap = new Map<string, any>()

    if (userIds.length > 0) {
      const { data: usersData } = await supabaseServer
        .from('users')
        .select('id, meno, priezvisko, email, telefon, typ_stravy, qr_code')
        .in('id', userIds)

      usersMap = new Map((usersData || []).map((u: any) => [u.id, u]))
    }

    const issueById = new Map(
      (activeIssuesData || []).map((issue: any) => [issue.id, issue])
    )

    activeIssueItems = rawItems.map((item: any) => {
      const itemUser = usersMap.get(item.user_id)
      const issue: any = issueById.get(item.hromadny_vydaj_id)
      const fullName = `${itemUser?.meno || ''} ${itemUser?.priezvisko || ''}`.trim()

      const isStillInGroup = memberIdSet.has(item.user_id)
      const isGroupSource = item.source === 'GROUP'
      const shouldShowRemovedFromGroup =
        isGroupSource &&
        !isStillInGroup &&
        item.status === 'PLANNED'

      return {
        id: item.id,
        issueId: item.hromadny_vydaj_id,
        userId: item.user_id,
        fullName: fullName || itemUser?.email || 'Bez mena',
        meno: itemUser?.meno || '',
        priezvisko: itemUser?.priezvisko || '',
        email: itemUser?.email || '',
        telefon: itemUser?.telefon || '',
        typStravy: item.volba || itemUser?.typ_stravy || '',
        qrCode: itemUser?.qr_code || '',
        role:
          shouldShowRemovedFromGroup
            ? '—'
            : item.source === 'QR_EXTRA'
              ? '—'
              : memberRoleMap.get(item.user_id) || '—',
        status: shouldShowRemovedFromGroup ? 'REMOVED' : item.status,
        source: item.source,
        addedByQr: item.source === 'QR_EXTRA',
        removeReason: shouldShowRemovedFromGroup
          ? 'REMOVED_FROM_GROUP'
          : item.remove_reason,
        removedAt: item.removed_at,
        entitlementStatus: issue
          ? getEntitlement(item.user_id, issue.datum, issue.typ_jedla)
          : 'UNKNOWN'
      }
    })
  }

  const activeIssues = (activeIssuesData || []).map((issue: any) => {
    const issueItems = activeIssueItems.filter(
      item => item.issueId === issue.id
    )

    const activeItems = issueItems.filter(
      item => item.status !== 'REMOVED'
    )

    const plannedItems = issueItems.filter(
      item => item.status === 'PLANNED'
    )

    const withoutEntitlementCount = plannedItems.filter(
      item => item.entitlementStatus === 'NO' || item.entitlementStatus === 'UNKNOWN'
    ).length

    return {
      ...issue,
      userIds: plannedItems.map(item => item.userId),
      peopleCount: activeItems.length,
      withoutEntitlementCount,
      items: issueItems
    }
  })

  return (
    <main style={styles.page}>
      <GroupIssueClient
        group={{
          id: groupId,
          name: group?.name || 'Skupina bez názvu'
        }}
        myRole={role}
        myName={myName}
        members={membersWithAvailability}
        activeIssues={activeIssues}
      />
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: 0,
    fontFamily: 'Arial, Helvetica, sans-serif',
    color: '#111827'
  }
}
