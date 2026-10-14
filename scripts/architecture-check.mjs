import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const repoRoot = process.cwd()
const srcRoot = path.join(repoRoot, 'src')

const findings = []

const allowedServiceRoleFiles = [
  path.normalize('src/lib/supabase/admin.ts'),
  path.normalize('src/app/api/progress/route.ts'),
  path.normalize('src/lib/exercise-library.ts'),
]

const allowedServiceRolePrefixes = [
  path.normalize('src/app/api/admin/'),
]

const clientReadinessAllowlist = [
  path.normalize('src/lib/readiness-log.ts'),
]

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return walk(fullPath)
    }
    return [fullPath]
  }))

  return files.flat()
}

function normalizeRelative(filePath) {
  return path.normalize(path.relative(repoRoot, filePath))
}

function isAllowedByPrefix(relativePath, prefixes) {
  return prefixes.some((prefix) => relativePath.startsWith(prefix))
}

function addFinding(relativePath, message) {
  findings.push(`${relativePath}: ${message}`)
}

const files = await walk(srcRoot)

for (const filePath of files) {
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(filePath)) {
    continue
  }

  const relativePath = normalizeRelative(filePath)
  const source = await readFile(filePath, 'utf8')

  if (
    source.includes('createServiceRoleClient(')
    && !allowedServiceRoleFiles.includes(relativePath)
    && !isAllowedByPrefix(relativePath, allowedServiceRolePrefixes)
  ) {
    addFinding(relativePath, 'unexpected createServiceRoleClient usage outside admin/server-managed paths')
  }

  if (
    source.includes(".from('readiness_logs')")
    && relativePath.includes(path.normalize('src/app/'))
    && !clientReadinessAllowlist.includes(relativePath)
    && source.includes("use client")
  ) {
    addFinding(relativePath, 'client component appears to write/read readiness_logs directly instead of using the API route')
  }

  if (
    source.includes('localStorage')
    && relativePath === path.normalize('src/lib/saved-workouts.ts')
  ) {
    addFinding(relativePath, 'saved workouts should stay server-synced and not use localStorage')
  }
}

if (findings.length > 0) {
  console.error('Architecture check failed:\n')
  findings.forEach((finding) => console.error(`- ${finding}`))
  process.exit(1)
}

console.log('Architecture check passed.')
