import { FullConfig } from '@playwright/test';
import * as https from 'https';
import * as http from 'http';
import { execSync } from 'child_process';

/**
 * Playwright Global Setup
 *
 * Runs ONCE before all e2e tests. Responsible for:
 * 1. Verifying the app server is reachable
 * 2. Seeding test credentials via the app's own registration endpoint
 *    (uses real HTTP — no Firebase Admin SDK needed in e2e runner)
 * 3. Writing auth state to disk so tests can reuse authenticated sessions
 *
 * Test users created here are identified by TEST_USER_* env vars,
 * which default to stable fixture values defined below.
 * They are cleaned up in global-teardown.ts.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

async function httpGet(url: string): Promise<{ status: number; data: any }> {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const urlObj = new URL(url);

        const req = lib.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (url.startsWith('https') ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            timeout: 5000,
        }, (res) => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode || 0, data: JSON.parse(raw) });
                } catch {
                    resolve({ status: res.statusCode || 0, data: raw });
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.on('error', reject);
        req.end();
    });
}

async function waitForServer(url: string, retries = 30): Promise<void> {
    for (let i = 0; i < retries; i++) {
        try {
            await httpGet(`${url}/api/health`);
            console.log(`✅ Server is reachable at ${url}`);
            return;
        } catch {
            if (i === retries - 1) {
                throw new Error(`❌ Server at ${url} is not reachable after ${retries} attempts`);
            }
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

export default async function globalSetup(config: FullConfig) {
    console.log('\n🔧 Playwright Global Setup starting...');

    // ── 1. Wait for server ──────────────────────────────────────────────────────
    await waitForServer(BASE_URL);

    // ── 1.5. Seed the database ──────────────────────────────────────────────────
    //
    // Two corrections to what stood here, both load-bearing:
    //
    // MISSING SCRIPTS. This block called `node scripts/seed-test-users.js` and
    // `npx tsx scripts/setup-e2e-coop.ts`. Neither file has ever existed on
    // main. The try/catch logged "⚠️ Database seeding failed" and continued,
    // so every e2e run silently skipped seeding — which is why the 22
    // auth-required specs have never been runnable. scripts/seed-local.ts is
    // the real seeder now.
    //
    // THE GUARD CHECKED THE WRONG URL. It skipped seeding when BASE_URL
    // contained "easysalesexport.com" — the address of the BROWSER, not of the
    // DATABASE. The configuration this repo actually has is the dangerous one:
    // BASE_URL=localhost while .env.local points at the production Supabase
    // project. Under the old guard, seeding would have written test users into
    // production. The database-side guard lives in seed-local.ts itself, which
    // refuses any non-localhost NEXT_PUBLIC_SUPABASE_URL; the check here is
    // only the browser-side belt to that braces.
    //
    // Seeding failure is now FATAL. A suite that runs unseeded fails later
    // with misleading "invalid credentials" errors — failing here, with the
    // real reason, is cheaper every time.
    if (BASE_URL.includes('easysalesexport.com')) {
        console.log('⚠️ BASE_URL is production — skipping seeding entirely.');
    } else {
        console.log('Seeding E2E database records (scripts/seed-local.ts)...');
        execSync('npx tsx scripts/seed-local.ts', { stdio: 'inherit' });
        console.log('✅ E2E database seeding completed.');
    }

    console.log('✅ Playwright Global Setup complete\n');
}
