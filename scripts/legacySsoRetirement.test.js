import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('legacy shared-token SSO retirement', () => {
  it('removes the browser token-sharing helper', () => {
    expect(existsSync(path.join(root, 'src/utils/sso.ts'))).toBe(false)
  })

  it('keeps /sso.html as a script-free retirement tombstone', () => {
    const html = readFileSync(path.join(root, 'public/sso.html'), 'utf8')
    expect(html).toContain('旧登录桥接已停用')
    expect(html).not.toMatch(/localStorage|postMessage|starstack_token|STARSTACK_SSO/)
  })

  it('fails both legacy paths at the production edge without logging query credentials', () => {
    const nginx = readFileSync(path.join(root, 'nginx.conf'), 'utf8')
    for (const pathname of ['/api/sso/session', '/sso.html']) {
      const escaped = pathname.replaceAll('/', '\\/').replace('.', '\\.')
      const location = nginx.match(new RegExp(`location = ${escaped} \\{([\\s\\S]*?)\\n    \\}`))?.[1] || ''
      expect(location).toContain('access_log off;')
      expect(location).toContain('return 410')
      expect(location).toContain('Cache-Control "no-store"')
    }
  })
})
