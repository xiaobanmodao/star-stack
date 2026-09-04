import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  MAX_AVATAR_BYTES,
  compressAvatarDataUrl,
  getPublicAvatarUrl,
  parseStoredAvatar,
} from './avatar.js'

describe('avatar transport', () => {
  it('keeps empty and legacy URL avatars compatible', () => {
    expect(getPublicAvatarUrl('alice', null)).toBeNull()
    expect(getPublicAvatarUrl('alice', '')).toBeNull()
    expect(getPublicAvatarUrl('alice', 'https://images.example/avatar.png'))
      .toBe('https://images.example/avatar.png')
  })

  it('turns stored data avatars into a same-origin cacheable URL', () => {
    expect(getPublicAvatarUrl('alice / 星', 'data:image/png;base64,YQ=='))
      .toBe('/api/users/alice%20%2F%20%E6%98%9F/avatar')
    expect(getPublicAvatarUrl('alice', 'DATA:IMAGE/PNG;BASE64,YQ=='))
      .toBe('/api/users/alice/avatar')
    expect(getPublicAvatarUrl('alice', true, { revision: 'upload-2' }))
      .toBe('/api/users/alice/avatar?v=upload-2')
    expect(getPublicAvatarUrl('alice', true, { revision: 0 }))
      .toBe('/api/users/alice/avatar?v=0')
  })

  it('decodes only supported stored bitmap data URLs', () => {
    const parsed = parseStoredAvatar('data:image/png;base64,aGVsbG8=')
    expect(parsed?.contentType).toBe('image/png')
    expect(parsed?.buffer.toString('utf8')).toBe('hello')
    expect(parseStoredAvatar('data:image/svg+xml;base64,PHN2Zy8+')).toBeNull()
    expect(parseStoredAvatar('not-an-avatar')).toBeNull()
  })

  it('normalizes uploaded avatars to a bounded WebP without changing their visible aspect ratio', async () => {
    const source = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 4,
        background: { r: 28, g: 84, b: 160, alpha: 0.72 },
      },
    }).png().toBuffer()

    const compressed = await compressAvatarDataUrl(`data:image/png;base64,${source.toString('base64')}`)
    const parsed = parseStoredAvatar(compressed)
    const metadata = await sharp(parsed.buffer).metadata()

    expect(parsed.contentType).toBe('image/webp')
    expect(parsed.buffer.length).toBeLessThan(MAX_AVATAR_BYTES)
    expect(metadata.width).toBe(512)
    expect(metadata.height).toBe(341)
    expect(metadata.hasAlpha).toBe(true)
  })

  it('keeps a noisy photo below the hard 200 KiB storage limit', async () => {
    const pixels = Buffer.alloc(900 * 900 * 3)
    let state = 0x12345678
    for (let index = 0; index < pixels.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      pixels[index] = state >>> 24
    }
    const source = await sharp(pixels, {
      raw: { width: 900, height: 900, channels: 3 },
    }).jpeg({ quality: 96 }).toBuffer()

    const compressed = await compressAvatarDataUrl(`data:image/jpeg;base64,${source.toString('base64')}`)
    const parsed = parseStoredAvatar(compressed)

    expect(source.length).toBeGreaterThan(MAX_AVATAR_BYTES)
    expect(parsed.buffer.length).toBeLessThan(MAX_AVATAR_BYTES)
  })

  it('preserves animated avatars while converting GIF frames to WebP', async () => {
    const pixels = Buffer.alloc(64 * 128 * 4)
    for (let y = 0; y < 128; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const offset = (y * 64 + x) * 4
        pixels[offset] = y < 64 ? 255 : 0
        pixels[offset + 1] = y < 64 ? 0 : 255
        pixels[offset + 3] = 255
      }
    }
    const source = await sharp(pixels, {
      raw: { width: 64, height: 128, channels: 4, pageHeight: 64 },
    }).gif({ delay: [100, 100], loop: 0 }).toBuffer()

    const compressed = await compressAvatarDataUrl(`data:image/gif;base64,${source.toString('base64')}`)
    const parsed = parseStoredAvatar(compressed)
    const metadata = await sharp(parsed.buffer, { animated: true }).metadata()

    expect(metadata.format).toBe('webp')
    expect(metadata.pages).toBe(2)
    expect(metadata.delay).toEqual([100, 100])
    expect(parsed.buffer.length).toBeLessThan(MAX_AVATAR_BYTES)
  })

  it('rejects spoofed or unsafe avatar payloads instead of passing them through', async () => {
    await expect(compressAvatarDataUrl('data:image/png;base64,aGVsbG8='))
      .rejects.toThrow('无法识别')
    await expect(compressAvatarDataUrl('data:image/svg+xml;base64,PHN2Zy8+'))
      .rejects.toThrow('仅支持')
  })
})
