import { FullConfig, chromium } from '@playwright/test';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'child_process';
import { loginAs, USERS } from './helpers/auth';
import { detectChromium } from './helpers/chromium';

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

    // ── 2. One signed-in session per persona, saved to disk ─────────────────────
    //
    // WHY: the smoke suites visit 205 pages, and a beforeEach login meant ~205
    // sign-ins in a single run. Two costs, and both bit:
    //
    //   The dev server compiles each route on first visit, and 200 logins on
    //   top of 205 first-time compilations was enough to kill the process
    //   partway through a run — 125 tests then failed with "socket hang up",
    //   none of them because anything was actually broken.
    //
    //   Against a production build it is worse and quieter:
    //   consumeLoginAttempt enforces 5 attempts per 15 minutes PER EMAIL once
    //   NODE_ENV is production, so the suite would rate-limit ITSELF and the
    //   failures would look like broken auth.
    //
    // Signing in once per persona and reusing the cookie removes both. It also
    // means the suite tests the pages rather than re-testing the login form
    // two hundred times — that has its own spec.
    await createPersonaSessions();

    console.log('✅ Playwright Global Setup complete\n');
}

/**
 * Sign in as each seeded persona once and write the session to
 * .auth/<persona>.json, for specs that declare
 * `test.use({ storageState: sessionFileFor('admin') })`.
 *
 * Failure is FATAL rather than skipped. A missing session file makes every
 * test using it run signed-out, which shows up as pages redirecting to login —
 * a confusing failure a long way from its cause.
 */
async function createPersonaSessions() {
    // Imported statically at the top of this file, not with a dynamic
    // import(). A dynamic import of a .ts module here bypasses Playwright's
    // TypeScript transform and fails with "Cannot use import statement outside
    // a module".
    const authDir = path.resolve(process.cwd(), '.auth');
    fs.mkdirSync(authDir, { recursive: true });

    // Same executable the test projects use — see helpers/chromium.ts.
    const browser = await chromium.launch({ executablePath: detectChromium() });
    try {
        for (const [name, account] of Object.entries(USERS)) {
            const context = await browser.newContext({ baseURL: BASE_URL });
            const page = await context.newPage();
            try {
                await loginAs(page, account.email, account.password);
                await context.storageState({ path: path.join(authDir, `${name}.json`) });
            } catch (error) {
                throw new Error(
                    `Could not sign in as the "${name}" persona (${account.email}). ` +
                    `Every spec that reuses this session would run signed-out and fail ` +
                    `somewhere far from here.\n${(error as Error).message}`
                );
            } finally {
                await context.close();
            }
        }
        console.log(`✅ Saved ${Object.keys(USERS).length} persona sessions to .auth/`);
    } finally {
        await browser.close();
    }
}
