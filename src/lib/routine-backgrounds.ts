type RoutineBackgroundInput = {
  sport?: string | null
  areas?: string[] | null
}

type RoutineBackgroundMatch = {
  image: string
  position?: string
}

const DEFAULT_ROUTINE_BACKGROUND: RoutineBackgroundMatch = {
  image: '/athlete-backgrounds/athletix-foam-roll.jpg',
  position: 'center 18%',
}

const SPORT_BACKGROUND_MAP: Record<string, RoutineBackgroundMatch> = {
  afl: { image: '/athlete-backgrounds/auth-login.avif', position: 'center 18%' },
  rugby: { image: '/athlete-backgrounds/rugby-team.jpg', position: 'center 18%' },
  soccer: { image: '/athlete-backgrounds/soccer-header.webp', position: 'center 18%' },
  netball: { image: '/athlete-backgrounds/netball-match.jpg', position: 'center 18%' },
  basketball: { image: '/athlete-backgrounds/basketball-dunk.webp', position: 'center 18%' },
  volleyball: { image: '/athlete-backgrounds/volleyball-spike.jpg', position: 'center 18%' },
  cricket: { image: '/athlete-backgrounds/cricket-bowling.jpg', position: 'center 18%' },
  golf: { image: '/athlete-backgrounds/golf-swing.jpg', position: 'center 18%' },
  tennis: { image: '/athlete-backgrounds/tennis-lunge.jpg', position: 'center 18%' },
  padel: { image: '/athlete-backgrounds/padel-court.jpg', position: 'center 18%' },
  wrestling: { image: '/athlete-backgrounds/wrestling-takedown.jpg', position: 'center 18%' },
  bjj: { image: '/athlete-backgrounds/bjj-training.jpg', position: 'center 16%' },
  weightlifting: { image: '/athlete-backgrounds/weightlifting-snatch.jpg', position: 'center 18%' },
  kickboxing: { image: '/athlete-backgrounds/boxing-ring.webp', position: 'center 18%' },
  muaythai: { image: '/athlete-backgrounds/muay-thai-ring.jpg', position: 'center 18%' },
  waterpolo: { image: '/athlete-backgrounds/water-polo-shot.jpg', position: 'center 18%' },
  highjump: { image: '/athlete-backgrounds/high-jump-bar.jpg', position: 'center 18%' },
  hurdles: { image: '/athlete-backgrounds/hurdles-race.jpg', position: 'center 18%' },
  handball: { image: '/athlete-backgrounds/handball-airborne.jpg', position: 'center 18%' },
}

const AREA_BACKGROUND_MAP: Record<string, RoutineBackgroundMatch> = {
  shoulders: { image: '/athlete-backgrounds/athletix-foam-roll.jpg', position: 'center 18%' },
  shoulder: { image: '/athlete-backgrounds/athletix-foam-roll.jpg', position: 'center 18%' },
  hips: { image: '/athlete-backgrounds/athletix-foam-roll.jpg', position: 'center 18%' },
  hip: { image: '/athlete-backgrounds/athletix-foam-roll.jpg', position: 'center 18%' },
  spine: { image: '/athlete-backgrounds/athletix-foam-roll.jpg', position: 'center 18%' },
  thoracic: { image: '/athlete-backgrounds/athletix-foam-roll.jpg', position: 'center 18%' },
  lumbar: { image: '/athlete-backgrounds/athletix-foam-roll.jpg', position: 'center 18%' },
  fullbody: DEFAULT_ROUTINE_BACKGROUND,
  'full body': DEFAULT_ROUTINE_BACKGROUND,
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function pickRoutineBackground({ sport, areas }: RoutineBackgroundInput): RoutineBackgroundMatch {
  if (sport) {
    const sportMatch = SPORT_BACKGROUND_MAP[normalizeKey(sport)]
    if (sportMatch) {
      return sportMatch
    }
  }

  for (const area of areas || []) {
    const areaMatch = AREA_BACKGROUND_MAP[normalizeKey(area)]
    if (areaMatch) {
      return areaMatch
    }
  }

  return DEFAULT_ROUTINE_BACKGROUND
}
