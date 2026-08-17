#!/usr/bin/env node
// Prüft die Konzeptdokumente auf Dinge, die beim Umbau leicht kaputtgehen:
// tote interne Links, verwaiste Dokumente und Rückstände abgelöster Plattformen.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const fail = (m) => { console.error(`✗ ${m}`); process.exitCode = 1 }
const ok = (m) => console.log(`✓ ${m}`)

const files = ['README.md', ...readdirSync('docs').filter((f) => f.endsWith('.md')).map((f) => join('docs', f))]

// ── 1. Interne Links auflösbar? ──────────────────────────────────────────────
let links = 0, broken = 0
for (const file of files) {
  const md = readFileSync(file, 'utf8')
  for (const m of md.matchAll(/\[[^\]]*\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    const target = m[1]
    if (/^(https?:|mailto:)/.test(target)) continue
    links++
    if (!existsSync(resolve(dirname(file), target))) {
      fail(`${file}: toter Link → ${target}`)
      broken++
    }
  }
}
if (!broken) ok(`${links} interne Links, alle auflösbar`)

// ── 2. Jedes Dokument im README verlinkt? ────────────────────────────────────
const readme = readFileSync('README.md', 'utf8')
for (const f of readdirSync('docs').filter((f) => f.endsWith('.md'))) {
  readme.includes(`docs/${f}`) ? null : fail(`docs/${f} ist im README nicht verlinkt`)
}
ok('alle Dokumente im README verlinkt')

// ── 3. Keine Rückstände der abgelösten Plattform ─────────────────────────────
// Erwähnungen sind erlaubt, wenn sie die frühere Fassung ausdrücklich vergleichen.
const forbidden = [
  [/\bwrangler\b/i, 'wrangler (Cloudflare-Workers-Tooling)'],
  [/Workers Secrets/i, 'Workers Secrets'],
  [/\bKV[- ]Cache\b/i, 'KV-Cache'],
  [/resolveDb/, 'resolveDb (D1-Sharding)'],
]
const comparative = /Cloudflare-(Variante|Fassung)|D1-Fassung|Vorversion|urspr[üu]nglich|revidiert|Vorgängerfassung/i
for (const file of files) {
  for (const [line, i] of readFileSync(file, 'utf8').split('\n').map((l, i) => [l, i + 1])) {
    for (const [re, label] of forbidden) {
      if (re.test(line) && !comparative.test(line)) fail(`${file}:${i}: Rückstand „${label}" ohne Vergleichskontext`)
    }
  }
}
ok('keine Plattform-Rückstände ohne Vergleichskontext')

// ── 4. Artefakt-Seite ────────────────────────────────────────────────────────
const html = readFileSync('docs/uebersicht.html', 'utf8')
const htmlChecks = [
  [/<title>[^<]+<\/title>/.test(html), '<title> vorhanden'],
  [!/<!DOCTYPE|<html[\s>]|<body[\s>]/i.test(html), 'kein eigenes doctype/html/body — wird beim Publish umschlossen'],
  [/:root\s*{[^}]*--paper/.test(html), 'helle Palette auf bare :root definiert'],
  [/prefers-color-scheme:\s*dark/.test(html) && /\[data-theme="dark"\]/.test(html), 'beide Dunkelmodus-Pfade abgedeckt'],
  [/body\s*{[^}]*background:\s*var\(--paper\)/.test(html), 'body setzt eine eigene Hintergrundfarbe'],
  [/overflow-x:\s*auto/.test(html), 'breite Inhalte scrollen im eigenen Container'],
]
for (const [pass, label] of htmlChecks) pass ? ok(label) : fail(`Artefakt-Seite: ${label} — fehlt`)

// ── 5. Kennzahlen konsistent ─────────────────────────────────────────────────
// Der gemessene Longtail-Anteil trägt den USP und darf nicht auseinanderlaufen.
const withFigure = files.filter((f) => readFileSync(f, 'utf8').includes('8,3'))
const inconsistent = files.filter((f) => {
  const t = readFileSync(f, 'utf8')
  return t.includes('8,3 %') && !t.includes('91,7') && !t.includes('92 %')
})
inconsistent.length
  ? fail(`Longtail-Kennzahl unvollständig zitiert in: ${inconsistent.join(', ')}`)
  : ok(`Longtail-Kennzahl in ${withFigure.length} Dokumenten konsistent`)

console.log(process.exitCode ? '\nDokumentprüfung fehlgeschlagen.' : '\nDokumentprüfung bestanden.')
