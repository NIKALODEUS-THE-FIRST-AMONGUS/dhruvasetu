// Photograph the built site with the Chrome already on this computer, and check that
// it runs clean: no console errors and no request to any other server.
//
//   npm run build && npm run shots
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { preview } from 'vite'

const PORT = 4173
const base = `http://localhost:${PORT}/`
const shots = [
  ['live-laptop-light', 1536, 864, '?still'],
  ['live-laptop-dark', 1536, 864, '?still&theme=dark'],
  ['live-projector-light', 1920, 1080, '?still'],
  ['live-phone-light', 390, 844, '?still'],
]

const server = await preview({ preview: { port: PORT, strictPort: true } })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
await mkdir('shots', { recursive: true })
const problems = []

for (const [name, width, height, query] of shots) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${name}: console error: ${message.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`${name}: ${error.message}`))
  page.on('request', (request) => {
    const url = request.url()
    if (!url.startsWith(base) && !url.startsWith('data:')) problems.push(`${name}: request to another server: ${url}`)
  })
  await page.goto(base + query, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `shots/${name}.png`, fullPage: width < 800 })
  const facts = await page.evaluate(() => {
    const value = document.querySelector('.tile__value')
    return {
      pageHeight: document.documentElement.scrollHeight,
      windowHeight: window.innerHeight,
      overflowsSideways: document.documentElement.scrollWidth > window.innerWidth,
      valuePx: value ? Math.round(parseFloat(getComputedStyle(value).fontSize)) : null,
      fonts: [...document.fonts].filter((font) => font.status === 'loaded').map((font) => `${font.family} ${font.style} ${font.weight}`),
    }
  })
  console.log(name, JSON.stringify(facts))
  await context.close()
}

// Let the sample play: reports must keep arriving and the numbers must follow.
{
  const context = await browser.newContext({ viewport: { width: 1536, height: 864 } })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`playing: console error: ${message.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`playing: ${error.message}`))
  await page.goto(base, { waitUntil: 'networkidle' })
  const read = () => page.evaluate(() => [document.querySelector('.state__clock')?.textContent, document.querySelector('.tile__value span')?.textContent])
  const before = await read()
  await page.waitForTimeout(6500)
  const after = await read()
  if (before[0] === after[0]) problems.push('playing: no new report arrived in 6.5 s')
  console.log('playing', JSON.stringify({ before, after }))
  await page.locator('a[href="#/system"]').click()
  await page.waitForTimeout(600)
  if (!(await page.locator('.placeholder h2').textContent())?.includes('System')) problems.push('playing: the System view did not open')
  await context.close()
}

await browser.close()
await server.close()
console.log(problems.length ? problems.join('\n') : 'clean: no console errors, no request to another server')
process.exit(problems.length ? 1 : 0)
