# Claude Recap

Move & Groove v2 is a Basic-first athlete mobility app running on Next.js + Supabase, with AI-assisted routine generation and a growing admin system for exercises and videos. The core product works end to end, but the codebase is still in an active hardening phase around analytics reliability, schema cleanup, and live QA.

## Current Product Truth

- Basic is the product right now.
- The core loop is live:
  - auth
  - dashboard
  - screening
  - quiz
  - pre-session readiness
  - routine
  - optional post-session check-in
  - results / dashboard
- `/programs` is now live.
- `/battery` and `/upgrade` are still placeholder / coming-soon surfaces.

## Most Important Current Architecture

### 1. Routine generation

Routine generation is now cheap-model first, not premium-model always.

Current order:

1. `gpt-4o-mini` when OpenAI is configured
2. Claude Sonnet when Anthropic is configured (primary if OpenAI is absent)
3. curated fallback, with a visible warning if AI is unavailable

Current defaults in code:

- OpenAI primary: `gpt-4o-mini`
- Anthropic model: `claude-sonnet-5-5` by default, overridable with `ANTHROPIC_MODEL`

Important file:

- `src/app/api/routines/generate/route.ts`

Operational truth:

- quality/safety is enforced in code, not entrusted to model output
- if `OPENAI_API_KEY` is missing, Anthropic can still carry the flow
- if both providers fail, curated fallback should still return a safe routine

### 2. Readiness

Pre-session readiness is now a real gate, not decorative UI.

Current behavior:

- readiness modal appears before building a new routine
- pre-session must save successfully before the user proceeds
- post-session is optional and should never block workout completion

Important files:

- `src/components/PreSessionReadinessModal.tsx`
- `src/components/PostSessionCheckinModal.tsx`
- `src/app/api/readiness-logs/route.ts`
- `src/lib/readiness.ts`
- `src/lib/readiness-log.ts`

Important schema truth:

- `readiness_logs` is still a legacy-risk table
- one recent live issue came from `intensity_modifier` being typed incorrectly in Supabase
- code now surfaces a clearer schema-mismatch error if that happens again

### 3. Progress and stats

Weekly stats come from `progress`, not from `readiness_logs`.

Current intended flow:

- finish workout
- routine page logs a `progress` row
- dashboard reads `progress`
- weekly minutes and session counts come from that table

Recent hardening already in code:

- workout completion stamps `completedAt` immediately
- routine page uses `keepalive` on `/api/progress`
- dashboard can recover a pending unsynced completed workout from `mg_routine`

Important files:

- `src/app/api/progress/route.ts`
- `src/app/routine/page.tsx`
- `src/app/dashboard/page.tsx`

### 4. Saved workouts

Saved workouts are now server-synced.

This is no longer local-storage membership only.

Current model:

- every completed workout can affect `progress`
- only explicitly saved workouts belong in the repeat library
- library cap is `10`
- server truth lives on `routines.is_saved` and `routines.saved_at`

Important files:

- `src/lib/saved-workouts.ts`
- `src/app/api/saved-workouts/route.ts`
- `src/app/results/page.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/routine/page.tsx`

### 5. Programmes

Multi-week programme persistence is live.

Current model:

- one active plan per user
- saved to `workout_plans`
- dashboard reads and shows the active plan
- `/programs` lets users create 4 / 8 / 12 week plans

Important files:

- `src/app/api/workout-plans/route.ts`
- `src/app/programs/page.tsx`
- `src/app/dashboard/page.tsx`

### 6. Admin / videos / exercise management

Admin is now more than a simple override table.

Current capabilities:

- bulk exercise video import
- YouTube channel sync
- custom exercise creation with:
  - exercise name
  - target area
  - pillar
  - YouTube ID / URL

Important files:

- `src/app/admin/page.tsx`
- `src/app/api/admin/exercise-videos/route.ts`
- `src/app/api/admin/youtube-sync/route.ts`
- `src/app/api/admin/custom-exercises/route.ts`
- `src/app/api/exercise-videos/route.ts`

YouTube sync truth:

- requires:
  - `YOUTUBE_API_KEY`
  - `YOUTUBE_CHANNEL_ID`
- auto-match works best when YouTube titles exactly match the exercise names in the app

## Clinical / Programming Rules That Must Stay True

- readiness may reduce volume and intensity
- readiness must never eliminate a phase
- every targeted area must still receive:
  - 1 release
  - 1 activation
  - 1 range
- rep-based drills must use `reps`
- hold-based drills must use `holdSeconds`
- do not fake rep-based work with `holdSeconds: 2`

Important files:

- `src/lib/curated-mobility.ts`
- `src/lib/readiness.ts`
- `src/app/api/routines/generate/route.ts`
- `src/app/routine/page.tsx`

## Security Truth

Security is much better than earlier versions, but easy to regress.

Preferred pattern:

- `createAuthClient(...)` for auth verification
- `createAccessTokenClient(...)` for RLS-aware user-scoped access
- `createServiceRoleClient(...)` only where truly necessary on admin/server-managed paths

Important files:

- `src/lib/supabase/admin.ts`
- `src/app/api/readiness-logs/route.ts`
- `src/app/api/progress/route.ts`
- `src/app/api/workout-plans/route.ts`
- `src/app/api/saved-workouts/route.ts`
- `src/app/api/exercise-videos/route.ts`

## Operational Truth

Current checks:

- `npm run typecheck` passes
- `npm run archcheck` passes
- the architecture-check script is active and catches:
  - unexpected service-role usage
  - direct client-side `readiness_logs` access
  - regressions of saved-workout logic

Current build truth:

- local `npm run build` can still fail on Windows when `.next` is locked by OneDrive / a running process
- this is usually an environment file-lock issue, not an app compile issue
- GitHub Actions still runs the clean build in CI:
  - `.github/workflows/app-health.yml`

## Known Realities

- `readiness_logs` still deserves careful live QA
- `screening_questionnaires` is still legacy-shaped
- live Supabase schema drift is still a real risk
- weekly stats depend on `progress`, so workout completion reliability remains a top-priority QA area
- `/battery` is still not a real product surface yet
- video ingestion is much better, but still depends on disciplined naming

## Best Next Steps

1. Keep testing workout completion -> `progress` -> dashboard stats on live Vercel.
2. Continue cleaning up Supabase schema drift, especially old legacy tables.
3. QA programme persistence and dashboard active-plan behavior on real accounts.
4. Keep improving admin video workflows and custom exercise coverage.
5. Continue sport-by-sport routine quality QA.
6. Keep Basic-first discipline; do not over-surface unfinished Premium experiences.
