# Move & Groove v2 - Developer Docs

> Last updated: June 16, 2026  
> Repo: `C:\Users\marco\OneDrive\Desktop\APP DRAFTS\move-and-groove-v2`  
> Primary branch: `main`  
> Hosting: Vercel  
> Stack: Next.js 16 + React 19 + Supabase + OpenAI + Anthropic  
> Product priority: Basic first, Premium later

---

## Overview

Move & Groove v2 is a Basic-first athlete mobility app with:

- account-based usage
- screening-led personalization
- readiness-aware session generation
- structured routine playback
- real progress logging
- explicit saved-workout library
- multi-week programme persistence
- admin-managed video and exercise tooling

The app is beyond prototype stage. The current engineering focus is:

- analytics reliability
- schema alignment
- clinical guardrails
- admin scalability
- AI operating cost
- mobile / tablet polish

---

## Current User Flow

### Basic flow

1. sign in
2. dashboard
3. screening
4. quiz
5. pre-session readiness
6. routine
7. optional post-session check-in
8. results / dashboard

### Programme flow

1. user opens `/programs`
2. selects duration, sessions/week, focus, and goal
3. plan is saved to `workout_plans`
4. dashboard shows active plan summary

---

## Route Status

### Live core routes

- `/`
- `/auth`
- `/dashboard`
- `/screening`
- `/quiz`
- `/routine`
- `/results`
- `/session-checkin`
- `/recovery`
- `/programs`
- `/admin`

### Still not fully live product surfaces

- `/battery`
- `/upgrade`

These are not ready to behave like polished sellable premium features.

---

## Main Architecture

## 1. AI routine generation

Primary route:

- `src/app/api/routines/generate/route.ts`

Current sequence:

1. OpenAI primary when configured
2. Claude Sonnet fallback (or primary when OpenAI is absent)
3. curated fallback with a visible warning when AI is unavailable

Current defaults:

- OpenAI primary: `gpt-4o-mini`
- Anthropic model: `claude-sonnet-5-5` by default

Relevant env vars:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_ROUTINE_PRIMARY_MODEL`
- `ANTHROPIC_MODEL` (optional override for the single Anthropic model)

Important truth:

- model orchestration is separate from clinical logic
- safety stays in code
- curated fallback remains the final safety net

### Generation guardrails

The code validates:

- approved exercise naming
- minimum phase coverage
- readiness adjustments
- prescription shape
- duration realism

Important files:

- `src/lib/curated-mobility.ts`
- `src/lib/readiness.ts`
- `src/app/api/routines/generate/route.ts`

---

## 2. Readiness system

Readiness is a real programming input, not cosmetic UI.

### Pre-session

- rendered through `PreSessionReadinessModal`
- must save successfully before completion continues
- writes through `/api/readiness-logs`
- route uses `createAccessTokenClient(...)`

### Post-session

- optional
- rendered through `PostSessionCheckinModal`
- should never block workout completion or progress logging

Important files:

- `src/components/PreSessionReadinessModal.tsx`
- `src/components/PostSessionCheckinModal.tsx`
- `src/app/api/readiness-logs/route.ts`
- `src/lib/readiness-log.ts`
- `src/lib/readiness-storage.ts`

### Current schema expectations for `readiness_logs`

Expected columns:

- `id`
- `user_id`
- `date`
- `session_type`
- `sleep_quality`
- `energy_level`
- `soreness_level`
- `niggled_region`
- `training_context`
- `intensity_modifier`
- `avoid_passive_holds`
- `reduce_region`
- `created_at`

Important risk:

- `readiness_logs` still behaves like a legacy table
- live schema mismatch can still break check-ins
- one confirmed issue was `intensity_modifier` being typed as `double precision` instead of `text`

---

## 3. Progress and dashboard stats

Dashboard stats come from `progress`, not from readiness tables.

### Intended flow

1. workout completes on `/routine`
2. routine page logs `/api/progress`
3. dashboard reads `/api/progress`
4. weekly graph and minutes update

Important files:

- `src/app/api/progress/route.ts`
- `src/app/routine/page.tsx`
- `src/app/dashboard/page.tsx`

### Current hardening in place

- completion timestamp is stamped into local routine meta as soon as the workout ends
- `keepalive: true` is used on progress write
- dashboard tries to recover a pending unsynced completed workout from local storage before loading stats
- GET `/api/progress` uses `cache: 'no-store'`

### Current reality

- this path is now much stronger than before
- live QA is still important because `progress` drives user trust in weekly stats

---

## 4. Saved workouts

Saved workouts are now server-synced.

Current model:

- only explicitly saved workouts belong in the library
- the library is backed by `routines.is_saved` and `routines.saved_at`
- max saved workouts: `10`

### API

- `GET /api/saved-workouts`
- `POST /api/saved-workouts`
- `DELETE /api/saved-workouts`

All use:

- `createAuthClient(...)` for verification
- `createAccessTokenClient(...)` for RLS-aware reads/writes

Important files:

- `src/lib/saved-workouts.ts`
- `src/app/api/saved-workouts/route.ts`
- `src/app/results/page.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/routine/page.tsx`

---

## 5. Programmes

Programmes are now a real persisted feature.

### Table

- `workout_plans`

### API

- `GET /api/workout-plans`
- `POST /api/workout-plans`

### UI

- `src/app/programs/page.tsx`
- `src/app/dashboard/page.tsx`

Current behavior:

- one active plan per user
- saving a new plan deactivates the previous active one
- dashboard shows:
  - plan name
  - current week
  - sessions completed this week
  - continue button

---

## 6. Admin architecture

Admin is now a real operational surface.

### What admin currently does

- shows overview data
- manages video overrides
- supports bulk video import
- supports YouTube channel sync
- supports adding custom exercises

### Important files

- `src/app/admin/page.tsx`
- `src/app/api/admin/overview/route.ts`
- `src/app/api/admin/exercise-videos/route.ts`
- `src/app/api/admin/youtube-sync/route.ts`
- `src/app/api/admin/custom-exercises/route.ts`

### Exercise video system

Runtime lookup order:

1. `exercise_videos` table
2. hardcoded fallback library

User-facing lookup route:

- `src/app/api/exercise-videos/route.ts`

### YouTube sync

Required env vars:

- `YOUTUBE_API_KEY`
- `YOUTUBE_CHANNEL_ID`

Current matching behavior:

- exact title match
- contains match
- normalized text match

Best naming rule:

- YouTube title should match the exercise name exactly

### Custom exercises

Custom exercise creation is now supported through admin.

Current fields:

- exercise name
- target area
- pillar
- YouTube ID / URL

Writes go to:

- `custom_exercises`
- `exercise_videos`

---

## 7. Clinical rules that must stay true

- readiness may reduce volume/intensity
- readiness must never remove a whole phase
- every targeted area must still receive:
  - 1 release
  - 1 activation
  - 1 range
- rep-based drills must use `reps`
- hold-based drills must use `holdSeconds`
- avoid fake rep prescriptions like `holdSeconds: 2`

Curated library validation intentionally fails if an exercise:

- has both `reps` and `holdSeconds`
- has neither
- has reps below `6`
- has hold duration below `20`

Important file:

- `src/lib/curated-mobility.ts`

---

## 8. Security model

Preferred pattern:

- `createAuthClient(...)` for token validation
- `createAccessTokenClient(...)` for user-scoped DB work
- `createServiceRoleClient(...)` only for true admin or carefully controlled server fallbacks

Important files:

- `src/lib/supabase/admin.ts`
- `src/app/api/readiness-logs/route.ts`
- `src/app/api/progress/route.ts`
- `src/app/api/workout-plans/route.ts`
- `src/app/api/saved-workouts/route.ts`
- `src/app/api/exercise-videos/route.ts`

Current security truth:

- readiness writes are sanitized
- saved-workout operations are authenticated
- exercise-video reads are authenticated
- progress uses access-token clients, with a controlled service-role fallback for some live policy/schema edge cases

---

## 9. Health checks and CI

Scripts:

- `npm run lint`
- `npm run typecheck`
- `npm run archcheck`
- `npm run build`
- `npm run healthcheck`

Architecture guard:

- `scripts/architecture-check.mjs`

CI workflow:

- `.github/workflows/app-health.yml`

Current results on the latest pass:

- `npm run typecheck` passed
- `npm run archcheck` passed
- local `npm run build` hit a Windows / OneDrive `.next` file lock (`EPERM unlink ...app-path-routes-manifest.json`)

Important note:

- that build failure is environmental, not a TypeScript or lint failure
- CI still runs the clean production build on GitHub Actions

---

## Known realities

- `readiness_logs` is still the most schema-sensitive table
- `screening_questionnaires` is still legacy-shaped
- local storage is still used for short-lived workflow state like `mg_routine`
- progress reliability has improved, but still deserves continued live QA
- `/battery` is still not a fully live feature
- there are still a couple of low-risk lint warnings in `src/app/routine/page.tsx`

---

## Best next steps

1. Keep live-testing workout completion -> progress -> dashboard stats.
2. Continue reducing legacy-table assumptions in Supabase-backed routes.
3. Keep admin video and custom exercise workflows tight and predictable.
4. Continue sport-by-sport QA on routine quality and duration feel.
5. Avoid broad Premium expansion until Basic trust signals are fully solid.

---

## Repo workflow rules

For this repo, the user prefers:

- clear `.git/index.lock` before git operations
- UTF-8 cleanup over `src` before every commit
- PowerShell commit commands
- separate commits per task when practical
- no unrelated files in commits
