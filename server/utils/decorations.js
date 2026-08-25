import { ACHIEVEMENTS, LEVELS, getLevelInfo } from '../stats.js'

export const AVATAR_FRAME_DEFINITIONS = [
  {
    id: 'none',
    name: '无边框',
    description: '保持原始头像样式。',
    minLevel: 1,
    unlockText: '默认可用',
  },
  {
    id: 'meteor',
    name: '流星轨道',
    description: '一道轻盈的蓝色流星轨道。',
    minLevel: 2,
    unlockText: '达到 Lv.2 解锁',
  },
  {
    id: 'planet',
    name: '行星环',
    description: '稳定而明亮的行星光环。',
    minLevel: 4,
    unlockText: '达到 Lv.4 解锁',
  },
  {
    id: 'supernova',
    name: '超新星',
    description: '高亮度的超新星能量边界。',
    minLevel: 6,
    unlockText: '达到 Lv.6 解锁',
  },
  {
    id: 'black-hole',
    name: '黑洞视界',
    description: '深色引力场与蓝紫色视界。',
    minLevel: 7,
    unlockText: '达到 Lv.7 解锁',
  },
]

export const AVATAR_OVERLAY_DEFINITIONS = [
  {
    id: 'none',
    name: '无叠加层',
    description: '不显示额外头像叠加图。',
    achievementType: null,
    unlockText: '默认可用',
  },
  {
    id: 'streak-100',
    name: '百日星环',
    description: '由连续 100 天的坚持点亮。',
    achievementType: 'streak_100',
    unlockText: '解锁「连续打卡 100 天」',
    asset: '/assets/decorations/streak-100-overlay.png',
  },
  {
    id: 'perfect-solve',
    name: '完美轨道',
    description: '首次提交即通过的精确轨道。',
    achievementType: 'perfect_solve',
    unlockText: '解锁「完美主义者」',
    asset: '/assets/decorations/perfect-solve-overlay.png',
  },
]

const getAchievement = (type) => ACHIEVEMENTS[String(type || '').toUpperCase()]

const getTitleDefinition = (titleId, levelInfo) => {
  if (!titleId) return null
  if (String(titleId).startsWith('level:')) {
    const level = Number(String(titleId).slice('level:'.length))
    const item = LEVELS[level - 1]
    if (!item || level > levelInfo.level) return null
    return {
      id: `level:${level}`,
      name: item.title,
      icon: item.icon,
      source: 'level',
    }
  }
  if (String(titleId).startsWith('honor:')) {
    const achievementType = String(titleId).slice('honor:'.length)
    const item = getAchievement(achievementType)
    if (!item) return null
    return {
      id: `honor:${item.id}`,
      name: item.name,
      icon: item.icon,
      source: 'honor',
      achievementType: item.id,
    }
  }
  return null
}

export const getDecorationIdentity = (user = {}, levelInfo = getLevelInfo(0)) => {
  const frame = AVATAR_FRAME_DEFINITIONS.find((item) => item.id === user.avatar_frame)
  const avatarFrame = frame && levelInfo.level >= frame.minLevel ? frame.id : 'none'
  const overlay = AVATAR_OVERLAY_DEFINITIONS.find((item) => item.id === user.avatar_overlay)
  const avatarOverlay = overlay ? overlay.id : 'none'
  const equipped = getTitleDefinition(user.equipped_title, levelInfo)
  const fallbackTitle = {
    id: `level:${levelInfo.level}`,
    name: levelInfo.title,
    icon: levelInfo.icon,
    source: 'level',
  }
  const displayTitle = equipped || fallbackTitle

  return {
    avatarFrame,
    avatarOverlay,
    equippedTitle: equipped?.id || null,
    displayTitle: displayTitle.name,
    displayTitleIcon: displayTitle.icon,
  }
}

const getUserXpAndAchievements = async (db, userId) => {
  const [stats, achievements] = await Promise.all([
    db.get(`SELECT xp FROM user_stats WHERE user_id = ?`, userId),
    db.all(`SELECT achievement_type FROM user_achievements WHERE user_id = ?`, userId),
  ])
  return {
    levelInfo: getLevelInfo(stats?.xp || 0),
    achievementTypes: new Set(achievements.map((item) => item.achievement_type)),
  }
}

export const getDecorationOptions = async (db, user) => {
  const { levelInfo, achievementTypes } = await getUserXpAndAchievements(db, user.id)
  const identity = getDecorationIdentity(user, levelInfo)
  const frames = AVATAR_FRAME_DEFINITIONS.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    unlockText: item.unlockText,
    unlocked: levelInfo.level >= item.minLevel,
  }))
  const overlays = AVATAR_OVERLAY_DEFINITIONS.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    unlockText: item.unlockText,
    asset: item.asset || null,
    unlocked: !item.achievementType || achievementTypes.has(item.achievementType),
  }))
  const titles = LEVELS.slice(0, levelInfo.level).map((item, index) => ({
    id: `level:${index + 1}`,
    name: item.title,
    icon: item.icon,
    source: 'level',
    unlockText: `达到 Lv.${index + 1} 解锁`,
    unlocked: true,
  }))
  for (const achievementType of achievementTypes) {
    const item = getAchievement(achievementType)
    if (!item) continue
    titles.push({
      id: `honor:${item.id}`,
      name: item.name,
      icon: item.icon,
      source: 'honor',
      unlockText: '已解锁荣誉',
      unlocked: true,
    })
  }

  return {
    equipped: identity,
    frames,
    overlays,
    titles,
    fallbackTitle: {
      id: `level:${levelInfo.level}`,
      name: levelInfo.title,
      icon: levelInfo.icon,
    },
  }
}

export const validateDecorationSelection = (options, selection) => {
  const frame = options.frames.find((item) => item.id === selection.avatarFrame)
  if (!frame || !frame.unlocked) return '头像框尚未解锁'
  const overlay = options.overlays.find((item) => item.id === selection.avatarOverlay)
  if (!overlay || !overlay.unlocked) return '头像叠加层尚未解锁'
  if (selection.equippedTitle !== null) {
    const title = options.titles.find((item) => item.id === selection.equippedTitle)
    if (!title || !title.unlocked) return '称号尚未解锁'
  }
  return null
}
