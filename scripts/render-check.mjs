#!/usr/bin/env node
// Rendert docs/uebersicht.html so, wie die Artefakt-Plattform es tun würde —
// eingebettet in ein doctype/head/body-Gerüst — und prüft, was sich beim
// Bearbeiten leicht kaputtmacht: seitlicher Überlauf und unlesbare Themes.

import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const fail = (m) => { console.error(`✗ ${m}`); process.exitCode = 1 }
const ok = (m) => console.log(`✓ ${m}`)

mkdirSync('.render', { recursive: true })

const src = readFileSync('docs/uebersicht.html', 'utf8')
const head = src.split('<div class="wrap">')[0]
const body = '<div class="wrap">' + src.split('<div class="wrap">').slice(1).join('<div class="wrap">')
writeFileSync('.render/preview.html', `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style>
${head}</head><body>${body}</body></html>`)

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const url = 'file://' + process.cwd() + '/.render/preview.html'

for (const [scheme, width] of [['light', 1280], ['dark', 1280], ['light', 390]]) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: scheme })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  const overflow = await page.evaluate((w) => (document.documentElement.scrollWidth > w ? document.documentElement.scrollWidth : 0), width)
  overflow ? fail(`${scheme} @${width}px: seitlicher Überlauf auf ${overflow}px`) : ok(`${scheme} @${width}px: kein seitlicher Überlauf`)

  // Text darf nicht auf gleichfarbigem Grund stehen — der klassische Theme-Fehler
  const contrast = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor
    const fg = getComputedStyle(document.querySelector('h1')).color
    return { bg, fg, same: bg === fg, transparent: bg === 'rgba(0, 0, 0, 0)' }
  })
  contrast.transparent ? fail(`${scheme}: body ohne eigene Hintergrundfarbe`) : null
  contrast.same ? fail(`${scheme}: Überschrift hat dieselbe Farbe wie der Grund`) : ok(`${scheme}: Vorder- und Hintergrund unterscheiden sich`)

  await page.screenshot({ path: `.render/${scheme}-${width}.png`, fullPage: true })
  await page.close()
}

await browser.close()
console.log(process.exitCode ? '\nRender-Prüfung fehlgeschlagen.' : '\nRender-Prüfung bestanden.')
