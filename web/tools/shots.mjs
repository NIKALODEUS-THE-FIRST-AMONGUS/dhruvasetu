// Photograph the built site with the Chrome already on this computer, and check that
// it runs clean: no console errors and no request to any other server.
//
//   npm run build && npm run shots
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { preview } from 'vite'

const PORT = 4199 // not 4173: start.cmd may be serving the page there
const base = `http://localhost:${PORT}/`
const shots = [
  ['live-laptop-light', 1536, 864, '?still&theme=light'],
  ['live-laptop-dark', 1536, 864, '?still&theme=dark'],
  ['live-projector-light', 1920, 1080, '?still&theme=light'],
  ['live-phone-light', 390, 844, '?still&theme=light'],
  ['live-laptop-guide', 1536, 864, '?still&theme=light&guide'],
  ['buoy-laptop-light', 1536, 864, '?still&theme=light#/buoy'],
  ['buoy-laptop-fault', 1536, 864, '?still&theme=light&fault=water_temp&part=water_temp#/buoy'],
  ['live-laptop-silent', 1536, 864, '?still&theme=light&fault=silent'],
  ['buoy-laptop-silent', 1536, 864, '?still&theme=dark&fault=silent&part=radio#/buoy'],
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
  // `?sample` keeps the page on its built-in sample: this check must not depend on the network or on the database.
  await page.goto(base + '?sample', { waitUntil: 'networkidle' })
  const read = () => page.evaluate(() => [document.querySelector('.state__clock')?.textContent, document.querySelector('.tile__value span')?.textContent])
  const before = await read()
  await page.waitForTimeout(6500)
  const after = await read()
  if (before[0] === after[0]) problems.push('playing: no new report arrived in 6.5 s')
  console.log('playing', JSON.stringify({ before, after }))
  await page.locator('a[href="#/buoy"]').click()
  await page.waitForTimeout(600)
  const dots = await page.locator('.section .dot').count()
  if (dots !== 12) problems.push(`playing: the Buoy view shows ${dots} dots, not 12`)
  await page.locator('.section .dot[aria-label^="Motion"]').click()
  await page.getByRole('button', { name: 'Check status' }).click()
  await page.waitForTimeout(3200)
  const answer = await page.locator('.part__test').textContent()
  if (!answer?.includes('MPU6050')) problems.push(`playing: no self-test answer, got: ${answer}`)
  console.log('self-test', JSON.stringify(answer))
  await page.goto(base + '?still&theme=light&fault=water_temp', { waitUntil: 'networkidle' })
  await page.locator('.tabs__item[href="#/data"]').hover()
  await page.locator('.link').click()
  await page.waitForTimeout(500)
  if (!(await page.locator('.pop').textContent())?.includes('Where the numbers come from')) problems.push('bar: the link details did not open')
  await page.screenshot({ path: 'shots/bar-open.png', clip: { x: 0, y: 0, width: 1536, height: 330 } })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  if ((await page.locator('.pop').count()) !== 0) problems.push('bar: Escape did not close the link details')
  await context.close()
}

// Let the sample run past its end, on a clock the test turns by hand. It must start again,
// and the page must never take the end of a file for a silent buoy.
{
  const context = await browser.newContext({ viewport: { width: 1536, height: 864 } })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`long run: console error: ${message.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`long run: ${error.message}`))
  await page.clock.install()
  await page.goto(base + '?sample', { waitUntil: 'networkidle' })
  const seen = []
  for (let step = 0; step < 30; step += 1) {
    await page.clock.runFor(10_000)
    seen.push(
      await page.evaluate(() => ({
        clock: document.querySelector('.state__clock')?.textContent ?? '',
        headline: document.querySelector('.state__headline')?.textContent ?? '',
        heard: document.querySelector('.link__heard')?.textContent ?? '',
      })),
    )
  }
  const restarts = seen.filter((now, index) => index > 0 && now.clock < seen[index - 1].clock).length
  if (seen.some((now) => now.headline.includes('Nothing heard') || now.heard.includes('silent'))) {
    problems.push('long run: the page called the buoy silent when the sample ended')
  }
  if (restarts < 2) problems.push(`long run: the sample started again ${restarts} times in 300 s, expected 2`)
  console.log('long run', JSON.stringify({ first: seen[0].clock, last: seen[seen.length - 1].clock, restarts }))
  await context.close()
}

await browser.close()
await server.close()
console.log(problems.length ? problems.join('\n') : 'clean: no console errors, no request to another server')
process.exit(problems.length ? 1 : 0)
