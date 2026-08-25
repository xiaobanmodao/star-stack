import type { Achievement } from '../../types'
import './HonorGrid.css'

const HONOR_IMAGE_BY_ID: Record<string, string> = {
  first_ac: '/assets/honors/first-ac.png',
  streak_7: '/assets/honors/streak-7.png',
  streak_30: '/assets/honors/streak-30.png',
  streak_100: '/assets/honors/streak-100.png',
  solved_10: '/assets/honors/solved-10.png',
  solved_50: '/assets/honors/solved-50.png',
  solved_100: '/assets/honors/solved-100.png',
  all_difficulty: '/assets/honors/all-difficulty.png',
  perfect_solve: '/assets/honors/perfect-solve.png',
  night_owl: '/assets/honors/night-owl.png',
  early_bird: '/assets/honors/early-bird.png',
}

type HonorGridProps = {
  achievements: Achievement[]
  maxItems?: number
  emptyText: string
}

export default function HonorGrid({ achievements, maxItems = 12, emptyText }: HonorGridProps) {
  const visibleAchievements = achievements.slice(0, maxItems)

  if (visibleAchievements.length === 0) {
    return <div className="profile-honors-empty">{emptyText}</div>
  }

  return (
    <div className="honor-grid" aria-label="已获得荣誉">
      {visibleAchievements.map((achievement) => {
        const description = achievement.description || achievement.desc || '完成对应条件后获得。'
        const image = HONOR_IMAGE_BY_ID[achievement.id]
        return (
          <button
            key={achievement.id}
            type="button"
            className="honor-card"
            data-rarity={achievement.rarity || 'common'}
            aria-label={`${achievement.name}：${description}`}
          >
            <span className="honor-card-art" aria-hidden="true">
              {image ? (
                <img src={image} alt="" loading="lazy" decoding="async" width="384" height="384" />
              ) : (
                <span className="honor-card-fallback">★</span>
              )}
            </span>
            <span className="honor-card-name">{achievement.name}</span>
            <span className="honor-card-popover" role="tooltip">
              <strong>{achievement.name}</strong>
              <span>{description}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
