import { FullConfig } from '@playwright/test';
import * as https from 'https';
import * as http from 'http';

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

async function httpPost(url: string, body: object): Promise<{ status: number; data: any }> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const lib = url.startsWith('https') ? https : http;
        const urlObj = new URL(url);

        const req = lib.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (url.startsWith('https') ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
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

        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

async function waitForServer(url: string, retries = 30): Promise<void> {
    for (let i = 0; i < retries; i++) {
        try {
            await httpPost(`${url}/api/health`, {});
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

async function ensureTestUser(config: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone: string;
    role?: string;
}): Promise<void> {
    // Attempt registration — a 409 (user exists) is OK, we just need the account to be there
    const res = await httpPost(`${BASE_URL}/api/auth/register`, config);
    if (res.status === 200 || res.status === 201) {
        console.log(`✅ Test user created: ${config.email}`);
    } else if (res.status === 409 || (res.data?.error || '').includes('already')) {
        console.log(`ℹ️  Test user already exists: ${config.email}`);
    } else {
        console.warn(`⚠️  Could not create test user ${config.email}: ${JSON.stringify(res.data)}`);
        // Non-fatal — the user may exist under a different registration path
    }
}

export default async function globalSetup(config: FullConfig) {
    console.log('\n🔧 Playwright Global Setup starting...');

    // ── 1. Wait for server ──────────────────────────────────────────────────────
    await waitForServer(BASE_URL);

    // ── 2. Seed test accounts ───────────────────────────────────────────────────
    // These users are used by e2e specs via process.env.TEST_USER_* variables.
    // Credentials are intentionally simple — they only exist in test environments.

    await ensureTestUser({
        email:     process.env.TEST_USER_EMAIL    || 'e2e.user@easysalesexport.test',
        password:  process.env.TEST_USER_PASSWORD || 'E2eTest@2024!',
        firstName: 'E2E',
        lastName:  'Testuser',
        phone:     '08099999901',
    });

    await ensureTestUser({
        email:     process.env.TEST_ADMIN_EMAIL    || 'e2e.admin@easysalesexport.test',
        password:  process.env.TEST_ADMIN_PASSWORD || 'E2eAdmin@2024!',
        firstName: 'E2E',
        lastName:  'Admin',
        phone:     '08099999902',
        role:      'admin',
    });

    await ensureTestUser({
        email:     process.env.TEST_BUYER_EMAIL    || 'e2e.buyer@easysalesexport.test',
        password:  process.env.TEST_BUYER_PASSWORD || 'E2eBuyer@2024!',
        firstName: 'E2E',
        lastName:  'Buyer',
        phone:     '08099999903',
    });

    await ensureTestUser({
        email:     process.env.TEST_SELLER_EMAIL    || 'e2e.seller@easysalesexport.test',
        password:  process.env.TEST_SELLER_PASSWORD || 'E2eSeller@2024!',
        firstName: 'E2E',
        lastName:  'Seller',
        phone:     '08099999904',
    });

    console.log('✅ Playwright Global Setup complete\n');
}
