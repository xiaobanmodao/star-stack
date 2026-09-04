import sharp from 'sharp'

const STORED_AVATAR_RE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i
const SUPPORTED_FORMATS = new Set(['png', 'jpeg', 'webp', 'gif'])
const MAX_AVATAR_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_AVATAR_INPUT_PIXELS = 16_000_000
const MAX_AVATAR_FRAMES = 120
const AVATAR_ATTEMPTS = [
  { size: 512, quality: 82 },
  { size: 512, quality: 70 },
  { size: 448, quality: 64 },
  { size: 384, quality: 58 },
  { size: 320, quality: 52 },
  { size: 256, quality: 46 },
  { size: 192, quality: 40 },
  { size: 128, quality: 34 },
  { size: 96, quality: 28 },
  { size: 64, quality: 20 },
]

export const MAX_AVATAR_BYTES = 200 * 1024

const normalizeContentType = (value) => value.toLowerCase() === 'image/jpg'
  ? 'image/jpeg'
  : value.toLowerCase()

export const getPublicAvatarUrl = (userId, avatar, { revision } = {}) => {
  if (!avatar || !userId) return null
  if (typeof avatar === 'string' && !/^data:image\//i.test(avatar)) return avatar
  const base = `/api/users/${encodeURIComponent(String(userId))}/avatar`
  if (revision === undefined || revision === null || revision === '') return base
  return `${base}?v=${encodeURIComponent(String(revision))}`
}

export const parseStoredAvatar = (value) => {
  if (typeof value !== 'string') return null
  const match = STORED_AVATAR_RE.exec(value)
  if (!match) return null
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length === 0) return null
  return {
    contentType: normalizeContentType(match[1]),
    buffer,
  }
}

export const compressAvatarDataUrl = async (value) => {
  const parsed = parseStoredAvatar(value)
  if (!parsed) throw new Error('仅支持 PNG/JPG/WebP/GIF 图片')
  if (parsed.buffer.length > MAX_AVATAR_SOURCE_BYTES) {
    throw new Error('图片过大，请选择小于 2MB 的图片')
  }

  let metadata
  try {
    metadata = await sharp(parsed.buffer, {
      animated: true,
      limitInputPixels: MAX_AVATAR_INPUT_PIXELS,
      sequentialRead: true,
    }).metadata()
  } catch {
    throw new Error('无法识别图片内容')
  }

  if (!SUPPORTED_FORMATS.has(metadata.format)) throw new Error('仅支持 PNG/JPG/WebP/GIF 图片')
  const expectedFormat = parsed.contentType === 'image/jpeg'
    ? 'jpeg'
    : parsed.contentType.slice('image/'.length)
  if (metadata.format !== expectedFormat) throw new Error('图片格式与内容不匹配')
  if (!metadata.width || !metadata.height) throw new Error('无法识别图片尺寸')
  if ((metadata.pages || 1) > MAX_AVATAR_FRAMES) throw new Error('动态头像帧数过多')

  for (const attempt of AVATAR_ATTEMPTS) {
    let pipeline = sharp(parsed.buffer, {
      animated: true,
      limitInputPixels: MAX_AVATAR_INPUT_PIXELS,
      sequentialRead: true,
    }).rotate()

    pipeline = pipeline.resize({
      width: attempt.size,
      height: attempt.size,
      fit: 'inside',
      withoutEnlargement: true,
    })

    const output = await pipeline.webp({
      quality: attempt.quality,
      alphaQuality: Math.max(attempt.quality, 50),
      effort: 4,
      smartSubsample: true,
      loop: metadata.loop,
      delay: metadata.delay,
    }).toBuffer()

    if (output.length < MAX_AVATAR_BYTES) {
      return `data:image/webp;base64,${output.toString('base64')}`
    }
  }

  throw new Error('图片内容过于复杂，无法压缩到 200KB 以下')
}
