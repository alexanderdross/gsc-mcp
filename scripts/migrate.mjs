#!/usr/bin/env node
// Wendet die kanonische Migration auf die in DATABASE_URL genannte Datenbank an.
// Bewusst schlank: die Migration ist streng vorwärtsgerichtet ([docs/03]).
//
// Aufruf:  DATABASE_URL=postgres://… node scripts/migrate.mjs

import { execFileSync } from 'node:child_process'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL fehlt.')
  process.exit(1)
}

const MIGRATION = 'packages/db/migrations/0001_init.sql'

try {
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', MIGRATION], { stdio: 'inherit' })
  console.log(`\n✓ Migration ${MIGRATION} angewendet.`)
} catch (e) {
  console.error(`\n✗ Migration fehlgeschlagen: ${e.message}`)
  process.exit(1)
}
