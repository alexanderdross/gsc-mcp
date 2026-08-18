#!/usr/bin/env node
// Wendet die kanonische Migration (packages/db/migrations/0001_init.sql) auf eine
// echte PostgreSQL-Instanz an und prüft Partitionsrouting, Partition Pruning und
// die Abstimmungsinvariante SUM(fact_query) = fact_totals. Die Migration ist die
// maßgebliche DDL-Quelle; docs/03-datenmodell.md dokumentiert sie.
//
// Aufruf:  PGURL=postgres://… node scripts/validate-ddl.mjs
// Ohne pg-Client-Bibliothek — nutzt psql, das in CI und lokal verfügbar ist.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MIGRATION = 'packages/db/migrations/0001_init.sql'
const PGURL = process.env.PGURL ?? 'postgres://postgres:postgres@localhost:5432/postgres'

const fail = (msg) => { console.error(`✗ ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`✓ ${msg}`)

// ── Kanonische Migration lesen ───────────────────────────────────────────────
const schema = readFileSync(MIGRATION, 'utf8')

if (!schema.includes('CREATE SCHEMA core')) fail('Migration enthält kein CREATE SCHEMA core')

const dir = mkdtempSync(join(tmpdir(), 'gscmcp-'))
const schemaFile = join(dir, 'schema.sql')
writeFileSync(schemaFile, schema)

const psql = (sql, file) =>
  execFileSync('psql', [PGURL, '-v', 'ON_ERROR_STOP=1', '-tAq', ...(file ? ['-f', file] : ['-c', sql])],
    { encoding: 'utf8' })

// ── 1. Schema aufbauen ───────────────────────────────────────────────────────
try {
  psql(null, schemaFile)
  ok(`Migration ${MIGRATION} fehlerfrei aufgebaut (${schema.split('CREATE ').length - 1} CREATE-Anweisungen)`)
} catch (e) {
  fail(`Schema-Aufbau fehlgeschlagen:\n${e.stderr ?? e.message}`)
  process.exit(1)
}

// ── 2. Erwartete Objekte ─────────────────────────────────────────────────────
const count = (sql) => Number(psql(sql).trim())
const checks = [
  ['Tabellen in core', "select count(*) from information_schema.tables where table_schema='core'", (n) => n >= 12],
  ['Tabellen in wh', "select count(*) from information_schema.tables where table_schema='wh'", (n) => n >= 12],
  ['partitionierte Faktentabellen', "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='p' and n.nspname='wh'", (n) => n === 6],
  ['Partitionsfunktion', "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='wh' and p.proname='ensure_month_partitions'", (n) => n === 1],
]
for (const [label, sql, pred] of checks) {
  const n = count(sql)
  pred(n) ? ok(`${label}: ${n}`) : fail(`${label}: ${n} — unerwartet`)
}

// ── 3. Funktionaler Test ─────────────────────────────────────────────────────
const fixture = `
SELECT wh.ensure_month_partitions('2026-07-01');
SELECT wh.ensure_month_partitions('2026-08-01');
INSERT INTO core.users (public_id, google_sub, email) VALUES ('u1','sub1','a@b.de');
INSERT INTO core.properties (public_id, user_id, site_url, kind, permission)
VALUES ('p1', 1, 'sc-domain:example.com', 'domain', 'siteOwner');
INSERT INTO wh.dim_query (property_id, text, word_count, first_seen, last_seen)
VALUES (1, 'beispiel', 1, '2026-07-20', '2026-08-16');
-- Echte Tageswerte aus der Messung an aip.aero, über eine Monatsgrenze hinweg
INSERT INTO wh.fact_totals (property_id, day, search_type, clicks, impressions, position_sum) VALUES
 (1,'2026-07-20','web',772,16666,16666*7.3),
 (1,'2026-08-16','web',989,30607,30607*7.8);
INSERT INTO wh.fact_query (property_id, day, search_type, query_id, clicks, impressions, position_sum) VALUES
 (1,'2026-07-20','web',1,  4,   26,   26*2.8),
 (1,'2026-07-20','web',0,768,16640,16640*7.31),
 (1,'2026-08-16','web',1,  5,   30,   30*2.7),
 (1,'2026-08-16','web',0,984,30577,30577*7.81);
`
writeFileSync(join(dir, 'fixture.sql'), fixture)
try {
  psql(null, join(dir, 'fixture.sql'))
} catch (e) {
  fail(`Testdaten konnten nicht eingefügt werden:\n${e.stderr ?? e.message}`)
  process.exit(1)
}

// 3a. Landen die Zeilen in den richtigen Monatspartitionen?
const parts = psql(`select tableoid::regclass::text from wh.fact_totals order by day`).trim().split('\n')
parts.join() === 'wh.fact_totals_202607,wh.fact_totals_202608'
  ? ok('Partitionsrouting: Zeilen liegen in der jeweiligen Monatspartition')
  : fail(`Partitionsrouting falsch: ${parts.join()}`)

// 3b. Greift Partition Pruning?
const plan = psql(`explain (costs off) select sum(clicks) from wh.fact_query
                   where property_id=1 and day between '2026-08-01' and '2026-08-31'`)
plan.includes('202608') && !plan.includes('202607')
  ? ok('Partition Pruning: nur die betroffene Monatspartition wird gelesen')
  : fail(`Partition Pruning greift nicht:\n${plan}`)

// 3c. Abstimmungsinvariante — die wichtigste Eigenschaft des Modells
const drift = psql(`
  select coalesce(sum(abs(t.clicks - q.s)), 0) from wh.fact_totals t
  join (select property_id, day, search_type, sum(clicks) s from wh.fact_query
        group by 1,2,3) q
    on q.property_id=t.property_id and q.day=t.day and q.search_type=t.search_type`).trim()
drift === '0'
  ? ok('Abstimmung: SUM(fact_query) = fact_totals, keine Drift')
  : fail(`Abstimmung verletzt, Drift ${drift}`)

// 3d. Impressionsgewichtete Durchschnittsposition über Tage hinweg
const pos = psql(`select round((sum(position_sum)/sum(impressions))::numeric,2) from wh.fact_totals`).trim()
pos === '7.62'
  ? ok(`Gewichtete Durchschnittsposition korrekt aggregiert: ${pos}`)
  : fail(`Durchschnittsposition ${pos}, erwartet 7.62`)

// 3e. Die Analysefunktionen, wegen derer PostgreSQL gewählt wurde
try {
  psql(`select percentile_cont(0.5) within group (order by clicks),
               regr_slope(clicks, extract(epoch from day))
          from wh.fact_totals`)
  ok('percentile_cont und regr_slope verfügbar — Grundlage der Analyse-Engine')
} catch {
  fail('percentile_cont/regr_slope nicht verfügbar')
}

console.log(process.exitCode ? '\nDDL-Validierung fehlgeschlagen.' : '\nDDL-Validierung bestanden.')
