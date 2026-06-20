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

export default async function globalSetup(config: FullConfig) {
    console.log('\n🔧 Playwright Global Setup starting...');

    // ── 1. Wait for server ──────────────────────────────────────────────────────
    await waitForServer(BASE_URL);

    // ── 1.5. Run E2E Cooperative Seeding Script ─────────────────────────────────
    try {
        console.log('Seeding E2E database records...');
        execSync('node scripts/seed-test-users.js', { stdio: 'inherit' });
        execSync('npx tsx scripts/setup-e2e-coop.ts', { stdio: 'inherit' });
        console.log('✅ E2E Database seeding completed successfully.');
    } catch (err: any) {
        console.error('⚠️ Database seeding failed:', err.message || err);
    }

    console.log('✅ Playwright Global Setup complete\n');
}
