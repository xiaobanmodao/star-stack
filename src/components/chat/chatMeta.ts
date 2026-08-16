import type { ChatModuleKey } from '../../types'

/** 聊天常用预设表情 */
export const PRESET_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '😮', '😢', '🤔', '⭐']

/** 模块频道元信息（聊天中心各处共用） */
export const MODULE_META: Record<ChatModuleKey, { icon: string; label: string }> = {
  general: { icon: '💬', label: '杂谈' },
  oj: { icon: '⚡', label: '评测OJ' },
  jieya: { icon: '🌱', label: '界芽计划' },
  starcode: { icon: '⌨️', label: 'StarCode' },
}

export const MODULE_KEYS: ChatModuleKey[] = ['general', 'oj', 'jieya', 'starcode']
