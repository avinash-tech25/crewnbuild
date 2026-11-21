// The app loads nothing from an origin the Content Security Policy does not allow; the map tile host is allow-listed there
// (infrastructure/nginx/security-headers.md): fonts are self-hosted, pictures are local.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP = resolve(__dirname, '../..')
const FORBIDDEN = /fonts\.googleapis\.com|fonts\.gstatic\.com/

function files(folder, out = []) {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) files(path, out)
    else if (/\.(jsx?|css|html)$/.test(name)) out.push(path)
  }
  return out
}

describe('Content Security Policy', () => {
  it('index.html loads no third-party stylesheet, script or font', () => {
    const html = readFileSync(join(APP, 'index.html'), 'utf8')
    expect(html).not.toMatch(FORBIDDEN)
    for (const [, url] of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)) {
      expect(url, url).not.toMatch(/^https?:\/\//)
    }
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/) // no inline script
  })

  it('no source file points at a font host', () => {
    const offenders = [...files(join(APP, 'src')), ...files(join(APP, 'public'))]
      .filter((path) => !path.endsWith('csp.test.js'))
      .filter((path) => FORBIDDEN.test(readFileSync(path, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('the self-hosted fonts are local files', () => {
    const css = readFileSync(join(APP, 'src/assets/fonts/fonts.css'), 'utf8')
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1])
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) expect(url).toMatch(/^\.\/[a-z-]+\.woff2$/)
  })

  it('the map tile host is allow-listed in the policy', () => {
    const policy = readFileSync(join(APP, '../../infrastructure/nginx/security-headers.md'), 'utf8')
    const partner = policy.slice(policy.indexOf('## Partner'))
    const tiles = readFileSync(join(APP, 'src/shared/constants/tracking.js'), 'utf8').match(/https:\/\/([^/{'"]+)\//)[1]
    const imgSrc = partner.match(/img-src ([^;]+);/)[1]
    expect(imgSrc.split(' ')).toContain(`https://${tiles}`)
  })
})
