import {
  ResizeFilterType,
  ResizeFit,
  Transformer,
} from '@napi-rs/image'

const STORED_AVATAR_RE = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i
const SUPPORTED_FORMATS = new Set(['png', 'jpeg', 'webp', 'gif'])
const MAX_AVATAR_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_AVATAR_INPUT_PIXELS = 16_000_000
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

  if (parsed.contentType === 'image/gif') {
    const signature = parsed.buffer.subarray(0, 6).toString('ascii')
    const width = parsed.buffer.length >= 10 ? parsed.buffer.readUInt16LE(6) : 0
    const height = parsed.buffer.length >= 10 ? parsed.buffer.readUInt16LE(8) : 0
    const hasImageFrame = parsed.buffer.includes(0x2c, 10)
    const hasTrailer = parsed.buffer.at(-1) === 0x3b
    if (!['GIF87a', 'GIF89a'].includes(signature)
      || !width || !height
      || width * height > MAX_AVATAR_INPUT_PIXELS
      || !hasImageFrame
      || !hasTrailer) {
      throw new Error('无法识别图片内容')
    }
    if (parsed.buffer.length >= MAX_AVATAR_BYTES) {
      throw new Error('动态头像必须小于 200KB')
    }
    return `data:image/gif;base64,${parsed.buffer.toString('base64')}`
  }

  let metadata
  try {
    metadata = await new Transformer(parsed.buffer).metadata()
  } catch {
    throw new Error('无法识别图片内容')
  }

  if (!SUPPORTED_FORMATS.has(metadata.format)) throw new Error('仅支持 PNG/JPG/WebP/GIF 图片')
  const expectedFormat = parsed.contentType === 'image/jpeg'
    ? 'jpeg'
    : parsed.contentType.slice('image/'.length)
  if (metadata.format !== expectedFormat) throw new Error('图片格式与内容不匹配')
  if (!metadata.width || !metadata.height) throw new Error('无法识别图片尺寸')
  if (metadata.width * metadata.height > MAX_AVATAR_INPUT_PIXELS) {
    throw new Error('图片像素尺寸过大')
  }

  const rotated = [5, 6, 7, 8].includes(metadata.orientation)
  const sourceWidth = rotated ? metadata.height : metadata.width
  const sourceHeight = rotated ? metadata.width : metadata.height

  for (const attempt of AVATAR_ATTEMPTS) {
    const scale = Math.min(1, attempt.size / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const output = await new Transformer(parsed.buffer)
      .rotate()
      .resize({
        width,
        height,
        fit: ResizeFit.Inside,
        filter: ResizeFilterType.Lanczos3,
      })
      .webp(attempt.quality)

    if (output.length < MAX_AVATAR_BYTES) {
      return `data:image/webp;base64,${output.toString('base64')}`
    }
  }

  throw new Error('图片内容过于复杂，无法压缩到 200KB 以下')
}
