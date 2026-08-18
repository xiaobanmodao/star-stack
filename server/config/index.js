import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const config = {
  // Server
  port: process.env.PORT || 5174,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  dbPath: path.join(__dirname, '..', 'data', 'starstack.sqlite'),

  // Auth
  adminId: process.env.ADMIN_ID || 'admin',
  adminName: process.env.ADMIN_NAME || '管理员',
  adminPassword: process.env.ADMIN_PASSWORD,

  // Judge
  tempDir: process.platform === 'win32'
    ? 'C:\\Temp\\starstack-oj'
    : '/tmp/starstack-oj',
  compileTimeout: 15000,
  runTimeout: 1500,

  // Rate limiting
  postCooldown: 10000, // 发帖冷却时间（毫秒）

  // File upload
  maxAvatarSize: 2 * 1024 * 1024, // 2MB

  // Pagination
  defaultPageSize: 20,
  maxPageSize: 100,
}
