import { NextRequest, NextResponse } from 'next/server'
import { requireAdminAccess } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  try {
    const { serviceClient } = await requireAdminAccess(req)
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)

    const [
      { count: totalUsers, error: usersError },
      { count: newSignupsThisWeek, error: signupsError },
      { count: totalScreenings, error: screeningsError },
      { count: totalRoutines, error: routinesError },
      { data: routineRows, error: routineRowsError },
    ] = await Promise.all([
      serviceClient.from('profiles').select('*', { count: 'exact', head: true }),
      serviceClient.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo.toISOString()),
      serviceClient.from('screening_questionnaires').select('*', { count: 'exact', head: true }),
      serviceClient.from('routines').select('*', { count: 'exact', head: true }),
      serviceClient.from('routines').select('sport, goal, duration_minutes'),
    ])

    const firstError = usersError || signupsError || screeningsError || routinesError || routineRowsError
    if (firstError) {
      throw new Error(firstError.message)
    }

    const sportsCount = new Map<string, number>()
    const goalsCount = new Map<string, number>()
    let durationTotal = 0
    let durationCount = 0

    for (const row of routineRows || []) {
      const sport = typeof row.sport === 'string' ? row.sport.trim() : ''
      const goal = typeof row.goal === 'string' ? row.goal.trim() : ''

      if (sport) {
        sportsCount.set(sport, (sportsCount.get(sport) || 0) + 1)
      }

      if (goal) {
        goalsCount.set(goal, (goalsCount.get(goal) || 0) + 1)
      }

      if (typeof row.duration_minutes === 'number') {
        durationTotal += row.duration_minutes
        durationCount += 1
      }
    }

    const mostPopularSports = [...sportsCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([label, count]) => ({ label, count }))

    const mostPopularGoals = [...goalsCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([label, count]) => ({ label, count }))

    return NextResponse.json({
      users: {
        totalRegisteredUsers: totalUsers || 0,
        newSignupsThisWeek: newSignupsThisWeek || 0,
        totalScreeningsCompleted: totalScreenings || 0,
        totalRoutinesGenerated: totalRoutines || 0,
      },
      routines: {
        mostPopularSports,
        mostPopularGoals,
        averageSessionDuration: durationCount > 0 ? Math.round((durationTotal / durationCount) * 10) / 10 : 0,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = message === 'Admin access required.' || message === 'Admin request is not authenticated.' || message === 'Missing admin access token.'
      ? 401
      : 500
    return NextResponse.json({ error: message }, { status })
  }
}
