/**
 * Put the LOCAL stack's Supabase credentials into process.env for the
 * real-database suite (jest.config.pg.js), before any module loads.
 *
 *   WHY THIS FILE EXISTS — AND IT IS A FINDING IN ITS OWN RIGHT
 *
 *   `./scripts/local-stack/up.sh` writes the local URL and keys to
 *   `.env.development.local`. Next only loads that file when NODE_ENV is
 *   `development`; jest sets NODE_ENV=test, so next/jest loads `.env.test*` and
 *   `.env` — neither of which exists here — and the file the stack just wrote is
 *   ignored.
 *
 *   The result was not a loud failure. `lib/supabase.ts` degrades a missing URL
 *   to PLACEHOLDER_SUPABASE_URL (#451, so a bad value cannot fail a build), so
 *   the admin client came up pointed at `https://placeholder.supabase.co` and
 *   every read failed with `TypeError: fetch failed`, wrapped by the adapter
 *   into a message naming the COLLECTION. It reads exactly like a broken query:
 *
 *       [supabase-db] aggregate processedPayments: TypeError: fetch failed
 *
 *   I lost a diagnosis to that before finding the cause was
 *   `getaddrinfo ENOTFOUND placeholder.supabase.co`. Any suite that talks to
 *   PostgREST would have hit the same wall — this one is simply the first.
 *
 *   Values already in the environment WIN, so an explicit
 *   `NEXT_PUBLIC_SUPABASE_URL=... npm run test:pg` still overrides this.
 *
 *   THIS FILE ONLY EVER READS .env.development.local, which points at
 *   127.0.0.1. The suites additionally assert the resolved host is loopback, so
 *   a stray remote URL cannot quietly turn a destructive test into one that runs
 *   against a real database.
 */

const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const FILE = join(__dirname, '..', '..', '.env.development.local');

if (existsSync(FILE)) {
    for (const line of readFileSync(FILE, 'utf-8').split('\n')) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!match) continue;

        const [, key] = match;
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        if (process.env[key] === undefined) process.env[key] = value;
    }
}
