import { useParams } from 'react-router-dom'
import PostBoard from './PostBoard'
import type { ChatModuleKey } from '../../types'
import { MODULE_KEYS } from '../../components/chat/chatMeta'

export default function ChannelPane() {
  const { key = '' } = useParams<{ key: string }>()
  const moduleKey = MODULE_KEYS.includes(key as ChatModuleKey) ? (key as ChatModuleKey) : 'general'
  return <PostBoard module={moduleKey} />
}
