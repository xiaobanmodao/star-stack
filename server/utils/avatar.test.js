import { describe, expect, it } from 'vitest'
import { Transformer } from '@napi-rs/image'
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
    const pixels = Buffer.alloc(1200 * 800 * 4)
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 28
      pixels[index + 1] = 84
      pixels[index + 2] = 160
      pixels[index + 3] = 184
    }
    const source = await Transformer.fromRgbaPixels(pixels, 1200, 800).png()

    const compressed = await compressAvatarDataUrl(`data:image/png;base64,${source.toString('base64')}`)
    const parsed = parseStoredAvatar(compressed)
    const metadata = await new Transformer(parsed.buffer).metadata()

    expect(parsed.contentType).toBe('image/webp')
    expect(parsed.buffer.length).toBeLessThan(MAX_AVATAR_BYTES)
    expect(metadata.width).toBe(512)
    expect(metadata.height).toBe(341)
    expect(metadata.colorType).toBeDefined()
  })

  it('keeps a noisy photo below the hard 200 KiB storage limit', async () => {
    const pixels = Buffer.alloc(600 * 600 * 3)
    let state = 0x12345678
    for (let index = 0; index < pixels.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      pixels[index] = state >>> 24
    }
    const rgba = Buffer.alloc(600 * 600 * 4)
    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < pixels.length; sourceIndex += 3, targetIndex += 4) {
      rgba[targetIndex] = pixels[sourceIndex]
      rgba[targetIndex + 1] = pixels[sourceIndex + 1]
      rgba[targetIndex + 2] = pixels[sourceIndex + 2]
      rgba[targetIndex + 3] = 255
    }
    const source = await Transformer.fromRgbaPixels(rgba, 600, 600).jpeg(96)

    const compressed = await compressAvatarDataUrl(`data:image/jpeg;base64,${source.toString('base64')}`)
    const parsed = parseStoredAvatar(compressed)

    expect(source.length).toBeGreaterThan(MAX_AVATAR_BYTES)
    expect(parsed.buffer.length).toBeLessThan(MAX_AVATAR_BYTES)
  })

  it('preserves already-small animated GIF bytes and their browser behaviour', async () => {
    const source = Buffer.from(
      'R0lGODlhQABAAIAAAExpcf8AACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAAQABAAAACRYyPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kzX9o3n+s73/g8MCofEovGITCqXzKbzCY1Kp9Sq9YrNarfcrjdQAAAh+QQFCgAAACwAAAAAQABAAIBMaXEA/wACRYyPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kzX9o3n+s73/g8MCofEovGITCqXzKbzCY1Kp9Sq9YrNarfcrjdQAAA7',
      'base64',
    )

    const compressed = await compressAvatarDataUrl(`data:image/gif;base64,${source.toString('base64')}`)
    const parsed = parseStoredAvatar(compressed)
    expect(parsed.contentType).toBe('image/gif')
    expect(parsed.buffer).toEqual(source)
    expect(parsed.buffer.length).toBeLessThan(MAX_AVATAR_BYTES)
  })

  it('rejects spoofed or unsafe avatar payloads instead of passing them through', async () => {
    await expect(compressAvatarDataUrl('data:image/png;base64,aGVsbG8='))
      .rejects.toThrow('无法识别')
    await expect(compressAvatarDataUrl('data:image/svg+xml;base64,PHN2Zy8+'))
      .rejects.toThrow('仅支持')
  })
})
