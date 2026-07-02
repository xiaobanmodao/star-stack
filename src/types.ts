export type UserRecord = {
  id: string
  name: string
  avatar?: string
  isAdmin?: boolean
  isBanned?: boolean
  createdAt?: string
}

export type OjProblemSummary = {
  id: number
  slug?: string
  title: string
  difficulty: string
  tags: string[]
  createdAt?: string
  acCount?: number
  totalCount?: number
  passRate?: number
}

export type OjProblemDetail = OjProblemSummary & {
  statement: string
  input: string
  output: string
  dataRange?: string
  samples: { input: string; output: string }[]
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
  results?: { index: number; status: string; message?: string; timeMs?: number }[]
  score?: number
  createdAt?: string
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
}

export type UserResponse = {
  user: UserRecord
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
  viewCount: number; likeCount: number; commentCount: number
  liked?: boolean; createdAt: string; updatedAt: string
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

export type AuthMode = 'login' | 'register'

export type AuthPageProps = {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onBack: () => void
  onSubmit: (event: React.FormEvent) => void
  formId: string
  formName: string
  formPassword: string
  formConfirm: string
  onFormIdChange: (value: string) => void
  onFormNameChange: (value: string) => void
  onFormPasswordChange: (value: string) => void
  onFormConfirmChange: (value: string) => void
  error: string
  success: string
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
