export type UserRecord = {
  id: string
  name: string
  email?: string | null
  avatar?: string
  isAdmin?: boolean
  isBanned?: boolean
  createdAt?: string
  onboarded?: boolean
  xp?: number
  level?: number
  title?: string
  icon?: string
  nextTitle?: string | null
  nextXp?: number | null
  progress?: number
}

export type AdminProblem = {
  id: number
  slug?: string
  title: string
  difficulty: string
  tags: string[]
  status: 'draft' | 'pending_review' | 'published' | 'hidden' | string
  creatorId?: string | null
  creatorName?: string
  testcaseCount?: number
  createdAt?: string
}

export type OjProblemSummary = {
  id: number
  slug?: string
  title: string
  difficulty: string
  tags: string[]
  createdAt?: string
  status?: 'draft' | 'pending_review' | 'published' | 'hidden' | string
  acCount?: number
  totalCount?: number
  passRate?: number
  solved?: boolean
}

export type OjProblemDetail = OjProblemSummary & {
  statement: string
  input: string
  output: string
  dataRange?: string
  samples: { input: string; output: string; timeLimitMs?: number }[]
  creatorId?: string
  creatorName?: string
  maxScore?: number | null
}

export type OjSubmission = {
  id: number
  problemId: number
  problemTitle?: string
  userId?: string
  userName?: string
  language: string
  status: string
  timeMs?: number
  memoryKb?: number
  message?: string
  code?: string | null
  canViewCode?: boolean
  results?: { index: number; status: string; message?: string; timeMs?: number; timeLimitMs?: number }[]
  score?: number
  createdAt?: string
  queuePosition?: number | null
  startedAt?: string | null
  finishedAt?: string | null
  attempts?: number
  updatedAt?: string | null
}
export type DifficultyStats = {
  solved: number
  tried: number
}

export type ProfileStats = {
  stats: {
    totalSolved?: number
    totalTried?: number
    totalSubmissions?: number
    rank?: number
    acceptedCount?: number
    solvedProblems?: number
    acceptanceRate?: number
    currentStreak?: number
    maxStreak?: number
    xp?: number
  }
  difficultyStats: Record<string, DifficultyStats>
}

export type HeatmapData = {
  date: string
  count: number
  accepted?: number
}

export type Achievement = {
  id: string
  name: string
  description: string
  desc?: string
  icon: string
  unlockedAt?: string
}

export type ProblemPlan = {
  id: number
  problemId: number
  problem_id: number
  title: string
  difficulty: string
  addedAt: string
  completed?: boolean
}

export type LeaderboardEntry = {
  userId: string
  userName: string
  avatar?: string
  rating?: number
  solvedCount?: number
  solvedProblems?: number
  totalSubmissions?: number
  acceptanceRate?: number
  rank: number
  value: number
  rankChange: number | null
  previousRank?: number | null
}
// API Response Types
export type ApiResponse<T = unknown> = {
  message?: string
  [key: string]: unknown
} & T

export type AuthResponse = {
  token: string
  user: UserRecord
  message?: string
  captchaRequired?: boolean
}

export type UserResponse = {
  user: UserRecord
  message?: string
}

export type CheckinResponse = {
  checkedToday: boolean
  currentStreak: number
  maxStreak: number
  totalDays: number
  alreadyChecked?: boolean
  success?: boolean
  message?: string
}

export type ProblemsResponse = {
  problems: OjProblemSummary[]
  total: number
  message?: string
}

export type ProblemResponse = {
  problem: OjProblemDetail
  message?: string
}

export type SolutionSummary = {
  id: number
  userId: string
  userName: string
  userAvatar?: string
  title: string
  likeCount: number
  commentCount: number
  viewCount: number
  createdAt: string
  isSolution: true
}

export type SolutionsResponse = {
  solutions: SolutionSummary[]
  canWrite: boolean
  message?: string
}

export type SubmissionsResponse = {
  submissions: OjSubmission[]
  total: number
  message?: string
}

export type SubmissionResponse = {
  submission: OjSubmission
  message?: string
}

export type StatsResponse = {
  problemCount: number
  userCount: number
  todaySubmissions: number
  message?: string
}

export type ProfileStatsResponse = ProfileStats & {
  message?: string
}

export type HeatmapResponse = HeatmapData[]

export type AchievementsResponse = Achievement[]

export type LeaderboardResponse = LeaderboardEntry[]
export type DiscussionPost = {
  id: number; userId: string; userName: string; userAvatar?: string
  title: string; content?: string
  problemId?: number; problemTitle?: string
  moduleKey?: ChatModuleKey
  viewCount: number; likeCount: number; commentCount: number
  isPinned?: boolean; isSolution?: boolean; liked?: boolean; createdAt: string; updatedAt: string
}

export type DiscussionComment = {
  id: number; postId: number; userId: string; userName: string; userAvatar?: string
  content: string; parentId?: number; likeCount: number; liked?: boolean
  createdAt: string; replies?: DiscussionComment[]; replyToName?: string
}

export type DiscussionListResponse = {
  posts: DiscussionPost[]; total: number; page: number; pageSize: number
}

export type DiscussionDetailResponse = {
  post: DiscussionPost; comments: DiscussionComment[]
}

export type Message = {
  id: number
  senderId: string
  senderName: string
  senderAvatar?: string
  content: string
  isRead: boolean
  createdAt: string
}

export type Conversation = {
  conversationId: number
  otherUser: {
    id: string
    name: string
    avatar?: string
  }
  lastMessage: {
    id: number
    senderId: string
    content: string
    createdAt: string
  } | null
  unreadCount: number
  lastMessageAt: string
}

export type ConversationsResponse = {
  conversations: Conversation[]
}

export type MessagesResponse = {
  messages: Message[]
  otherUser: {
    id: string
    name: string
    avatar?: string
    isBanned: boolean
  }
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export type UnreadCountResponse = {
  unreadCount: number
}

// ============ 聊天中心 ============

export type ChatModuleKey = 'general' | 'oj' | 'jieya' | 'starcode'

export type ChatReaction = {
  emoji: string
  count: number
  mine: boolean
}

export type ChatMessage = {
  id: number
  senderId: string
  senderName: string
  senderAvatar?: string | null
  content: string
  createdAt: string
  reactions: ChatReaction[]
  threadParentId?: number | null
  threadReplyCount: number
}

export type ChatChannel = {
  key: ChatModuleKey
  name: string
  icon?: string | null
  description?: string | null
  sortOrder: number
  unread: number
}

export type ChatChannelsResponse = {
  channels: ChatChannel[]
}

export type ChatMessageListResponse = {
  messages: ChatMessage[]
  hasMore: boolean
}

export type ChatRoomMember = {
  userId: string
  userName: string
  userAvatar?: string | null
  role: 'owner' | 'member'
  online: boolean
}

export type ChatRoom = {
  id: number
  name: string
  description: string
  type: 'public' | 'invite'
  ownerId: string
  ownerName: string
  memberCount: number
  createdAt: string
  joined: boolean
  unread: number
}

export type ChatRoomDetail = ChatRoom & {
  members: ChatRoomMember[]
  myRole?: 'owner' | 'member' | null
}

export type ChatRoomsResponse = {
  rooms: ChatRoom[]
}

export type ChatRoomResponse = {
  room?: ChatRoomDetail
  message?: string
}

export type ChatUnreadResponse = {
  channels: Record<string, number>
  rooms: Record<string, number>
  total: number
}

export type ChatStreamEvent =
  | { type: 'connected' }
  | { type: 'ping' }
  | { type: 'message'; message: ChatMessage }
  | { type: 'reaction'; messageId: number; reactions: ChatReaction[] }
  | { type: 'members'; members: ChatRoomMember[] }
  | { type: 'typing'; userId: string; userName: string }
  | { type: 'thread_reply'; message: ChatMessage }
  | { type: 'message_deleted'; messageId: number }
  | { type: 'closed' }

// ============ 好友系统 ============

export type FollowRelations = {
  following: boolean
  followedBy: boolean
  isFriend: boolean
  followerCount: number
  followingCount: number
  friendCount: number
}

export type UserProfile = {
  id: string
  name: string
  avatar?: string | null
  isAdmin: boolean
  bio?: string
  createdAt: string
  xp?: number
  level?: number
  title?: string
  icon?: string
  nextTitle?: string | null
  nextXp?: number | null
  progress?: number
}

export type UserProfileResponse = {
  user: UserProfile
  relations: FollowRelations
  blocked?: boolean
  message?: string
}

export type FollowUser = {
  id: string
  name: string
  avatar?: string | null
  online: boolean
  isFriend?: boolean
  followedAt?: string
}

export type FriendsResponse = {
  friends: FollowUser[]
}

export type FollowListResponse = {
  users: FollowUser[]
}

// ============ 通知中心 ============

export type NotificationType = 'follow' | 'comment' | 'reply' | 'mention' | 'invite' | 'achievement.unlocked' | 'problem.review_requested' | 'problem.status_changed'

export type NotificationItem = {
  id: number
  type: NotificationType
  actor: { id: string; name: string; avatar?: string | null }
  message: string
  targetType?: string | null
  targetId?: number | null
  isRead: boolean
  createdAt: string
}

export type NotificationsResponse = {
  notifications: NotificationItem[]
  unreadCount: number
  total: number
  page: number
  pageSize: number
}

// ============ 游戏化（聊天成就 / 活跃度） ============

export type ChatAchievement = {
  type: string
  name: string
  icon: string
  desc: string
  unlockedAt: string
}

export type ChatStatsResponse = {
  stats: {
    messageCount: number
    replyCount: number
    postCount: number
    commentCount: number
    reactionReceived: number
    activityScore: number
    activeDays: number
  }
  achievements: ChatAchievement[]
}

export type ChatAchievementsResponse = {
  achievements: ChatAchievement[]
}

export type ActivityLeaderboardEntry = {
  rank: number
  userId: string
  userName: string
  userAvatar?: string | null
  score: number
}

export type ActivityLeaderboardResponse = {
  days: number
  leaderboard: ActivityLeaderboardEntry[]
  me: { userId: string; score: number; rank: number | null }
}

// ============ 举报 ============

export type ReportTargetType = 'post' | 'comment' | 'message' | 'user'

export type AdminReport = {
  id: number
  reporterId: string
  reporterName: string
  targetType: ReportTargetType
  targetId: number | string
  reason: string
  status: 'open' | 'resolved'
  summary: string
  resolutionNote?: string
  resolvedBy?: string | null
  resolvedAt?: string | null
  createdAt: string
}

export type AdminAuditLog = {
  id: number
  adminId?: string | null
  adminName: string
  action: string
  targetType: string
  targetId?: string | null
  detail?: string | null
  createdAt: string
}

export type AdminStatsResponse = {
  stats: {
    users: number
    posts: number
    comments: number
    chatMessages: number
    rooms: number
    openReports: number
    pendingProblems: number
    todayActive: number
  }
}

export type AdminMetricsResponse = {
  metrics: {
    process: {
      uptimeSeconds: number
      rss: string
      heapUsed: string
    }
    database: {
      users: number
      problems: number
      revisions: number
      statusHistory: number
      submissions: Record<string, number>
    }
    judge: {
      activeJudges: number
      queuedJudges: number
      maxActiveJudges: number
      maxQueuedJudges: number
      activeRuns: number
      queuedRuns: number
      maxActiveRuns: number
      maxQueuedRuns: number
    }
    backup: {
      latest?: { name: string; size: string; updatedAt: string } | null
      ageSeconds?: number | null
      healthy: boolean
      retentionCount: number
    }
  }
}

export type AuthMode = 'login' | 'register'

export type AuthPageProps = {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onBack: () => void
  onSubmit: (event: React.FormEvent) => void
  formId: string
  formName: string
  formEmail: string
  formEmailCode: string
  formPassword: string
  formConfirm: string
  onFormIdChange: (value: string) => void
  onFormNameChange: (value: string) => void
  onFormEmailChange: (value: string) => void
  onFormEmailCodeChange: (value: string) => void
  onFormPasswordChange: (value: string) => void
  onFormConfirmChange: (value: string) => void
  onSendEmailCode: () => void
  error: string
  success: string
  submitting: boolean
  emailSending: boolean
  emailCooldown: number
  captchaRequired: boolean
  captchaResetKey: number
  onCaptchaTokenChange: (token: string) => void
}

// Context type for shared app state
export type AppContextType = {
  currentUser: UserRecord | null
  setCurrentUser: (user: UserRecord | null) => void
  problemPlan: ProblemPlan[]
  openAuth: (mode: AuthMode) => void
  addToPlan: (problemId: number) => Promise<{ success: boolean; message?: string }>
  removeFromPlan: (planId: number) => Promise<{ success: boolean; message?: string }>
  togglePlanComplete: (planId: number, completed: boolean) => Promise<{ success: boolean; message?: string }>
  loadProblemPlan: () => Promise<void>
  fetchUnreadCount: () => Promise<void>
}
