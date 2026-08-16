/**
 * Seed a LOCAL database with the fixtures the e2e suite expects.
 *
 * Run:  npx tsx scripts/seed-local.ts
 * Or:   npm run seed:local
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * e2e/global-setup.ts has always called `node scripts/seed-test-users.js` and
 * `npx tsx scripts/setup-e2e-coop.ts`. NEITHER FILE EXISTS anywhere in the
 * repository or its history reachable from main. The call is wrapped in a
 * try/catch that logs "⚠️ Database seeding failed" and continues, so every e2e
 * run has silently skipped seeding — which is precisely why the 22
 * auth-required specs have never been runnable. A failure that logs a warning
 * and proceeds looks identical to success unless someone reads the log.
 *
 * THE GUARD, AND WHY IT CHECKS THE DATABASE RATHER THAN THE APP URL
 * -----------------------------------------------------------------
 * The old guard skipped seeding when BASE_URL contained "easysalesexport.com".
 * That checks where the BROWSER points, not where the WRITES go. The dangerous
 * configuration — the one this repository actually has, per migration 004's
 * own notes — is BASE_URL=localhost with .env.local pointing at the production
 * Supabase project. Under the old guard that would have seeded test users
 * into production. This script refuses to write anywhere that is not
 * localhost, and the override is deliberately verbose so it cannot be typed by
 * accident.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';

// Prefer the generated local file; fall back to whatever the shell exported.
// Deliberately NOT loading .env.local here — that file points at production.
if (existsSync('.env.development.local')) loadEnv({ path: '.env.development.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function fail(msg: string): never {
    console.error(`\n❌ ${msg}\n`);
    process.exit(1);
}

if (!url || !serviceKey) {
    fail(
        'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.\n' +
        '   Start the local stack first:  npm run dev:local\n' +
        '   (This script does not read .env.local on purpose — it points at production.)'
    );
}

const host = new URL(url).hostname;
const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
if (!isLocal && process.env.SEED_ALLOW_REMOTE !== 'yes-seed-a-remote-database') {
    fail(
        `Refusing to seed ${host} — it is not a local database.\n` +
        '   This guard exists because .env.local points at the production project.\n' +
        '   If you truly mean to seed a remote STAGING database, set\n' +
        '   SEED_ALLOW_REMOTE=yes-seed-a-remote-database'
    );
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

/** The identities every spec defaults to (see playwright.config.ts header). */
const USERS = [
    { key: 'user',  email: process.env.TEST_USER_EMAIL  || 'e2e.user@easysalesexport.com',  password: process.env.TEST_USER_PASSWORD  || 'E2eTest@2024!',  roles: ['member'],                name: 'E2E Member' },
    { key: 'admin', email: process.env.TEST_ADMIN_EMAIL || 'e2e.admin@easysalesexport.com', password: process.env.TEST_ADMIN_PASSWORD || 'E2eAdmin@2024!', roles: ['admin', 'super_admin'],  name: 'E2E Admin' },
    { key: 'buyer', email: process.env.TEST_BUYER_EMAIL || 'e2e.buyer@easysalesexport.com', password: process.env.TEST_BUYER_PASSWORD || 'E2eBuyer@2024!', roles: ['member', 'buyer'],       name: 'E2E Buyer' },
    { key: 'seller', email: process.env.TEST_SELLER_EMAIL || 'e2e.seller@easysalesexport.com', password: process.env.TEST_SELLER_PASSWORD || 'E2eSeller@2024!', roles: ['member', 'seller'], name: 'E2E Seller' },
] as const;

/** Auth identity first, then the profile row with the SAME id — the order the
 *  registration flow itself uses. Idempotent: reruns update rather than fail. */
async function seedUser(u: (typeof USERS)[number]): Promise<string> {
    let id: string | undefined;

    const { data: created, error } = await admin.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
    });

    if (created?.user) {
        id = created.user.id;
    } else if (error && /already/i.test(error.message)) {
        // listUsers has no filter; page through the (small, local) set.
        const { data: page } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        id = page?.users.find(x => x.email === u.email)?.id;
    }
    if (!id) fail(`Could not create or find auth user ${u.email}: ${error?.message}`);

    const now = new Date().toISOString();
    const raw = {
        id, email: u.email, name: u.name, fullName: u.name,
        roles: u.roles, isVerified: true, verified: true,
        // profileComplete is what lib/hub-guard.ts checks, strictly against
        // `=== true`, before allowing the dashboard or any module. Without it
        // every seeded user logged in successfully and was bounced to
        // /profile?notice=complete-your-hub-registration, so all 22
        // auth-required specs failed on a redirect that looked like a broken
        // login. The fixture has to satisfy the guard the app actually applies.
        profileComplete: true,
        requiresPasswordChange: false,
        gender: 'female', state: 'Plateau', lga: 'Jos North',
        serviceRegistrations: u.key === 'user'
            ? { cooperatives: { status: 'active', registeredAt: now } }
            : {},
        createdAt: now, updatedAt: now,
    };
    const { error: upErr } = await admin.from('users').upsert(
        { id, email: u.email, roles: u.roles as unknown as string[], raw_data: raw },
        { onConflict: 'id' }
    );
    if (upErr) fail(`users row for ${u.email}: ${upErr.message}`);

    console.log(`  👤 ${u.key.padEnd(6)} ${u.email} (${id})`);
    return id;
}

/** Generic-table document, the shape supabase-db.ts writes. */
async function doc(collection: string, id: string, data: Record<string, any>) {
    const { error } = await admin.from('document_collections').upsert(
        { id, collection_name: collection, raw_data: { id, ...data } },
        { onConflict: 'id,collection_name' }
    );
    if (error) fail(`${collection}/${id}: ${error.message}`);
}

async function main() {
    console.log(`\n🌱 Seeding ${url}\n`);

    const ids: Record<string, string> = {};
    for (const u of USERS) ids[u.key] = await seedUser(u);

    const now = new Date().toISOString();

    // Cooperative membership for the member user — ACTIVE and paid, with
    // enough savings to qualify for a loan under the confirmed rule
    // (savings must be at least twice the loan: 40,000 saved → 20,000 max).
    const { error: memErr } = await admin.from('cooperative_members').upsert({
        id: ids.user,
        user_id: ids.user,
        status: 'active',
        raw_data: {
            id: ids.user, userId: ids.user,
            membershipStatus: 'active', paymentStatus: 'completed',
            tier: 'Member', totalContributions: 40000,
            cooperativeId: 'default', memberNumber: 'E2E-0001',
            joinedAt: now, createdAt: now, updatedAt: now,
        },
    }, { onConflict: 'id' });
    if (memErr) fail(`cooperative_members: ${memErr.message}`);

    // Wallet for the buyer.
    const { error: walErr } = await admin.from('wallets').upsert({
        id: ids.buyer, balance: 50000,
        raw_data: { id: ids.buyer, balance: 50000, currency: 'NGN', createdAt: now },
    }, { onConflict: 'id' });
    if (walErr) fail(`wallets: ${walErr.message}`);

    // Loan product with the confirmed terms: 10% MONTHLY, max 12 months.
    await doc('loan_products', 'e2e-loan-product', {
        name: 'E2E Cooperative Loan', description: 'Seeded for e2e runs',
        interestRate: 10, durationMonths: 12,
        minAmount: 5000, maxAmount: 500000,
        isActive: true, createdAt: now,
    });

    // Marketplace products owned by the seller.
    //
    // The shape here MATCHES WHAT /api/marketplace/create-product ACTUALLY
    // WRITES. It used to carry `stock: 25` — a field no writer sets and no
    // reader reads. The products API resolves quantity from `quantity` or
    // `availableQuantity`, so every seeded product came back with quantity 0
    // and read as out of stock.
    //
    // A fixture that does not match the real write shape is worse than no
    // fixture: it makes a broken reader look correct, or a working one look
    // broken, and either way the test measures the seed rather than the code.
    // `pricingTiers` and `location` are here for the same reason — the mapper
    // reads both, and a product without them renders at price 0 in "Nigeria".
    for (let i = 1; i <= 3; i++) {
        await doc('products', `e2e-product-${i}`, {
            name: `E2E Test Product ${i}`,
            title: `E2E Test Product ${i}`,
            description: 'Seeded for e2e runs',
            category: 'grains',
            unit: 'kg',
            price: 1000 * i,
            pricingTiers: [{ type: 'retail', price: 1000 * i, minQuantity: 1 }],
            minOrder: 1,
            minimumOrderQuantity: 1,
            stockQuantity: 25,
            availableQuantity: 25,
            location: { state: 'Plateau', lga: 'Jos North', nearestMarket: 'Jos Main Market' },
            sellerId: ids.seller, sellerName: 'E2E Seller',
            rating: 0, reviewCount: 0, totalOrders: 0, views: 0, orders: 0,
            status: 'active', isActive: true, images: [], createdAt: now, updatedAt: now,
        });
    }

    // One notification so the bell has something real to render.
    await doc('notifications', 'e2e-notification-1', {
        userId: ids.user, type: 'system', read: false,
        title: 'Welcome to the test environment',
        message: 'Seeded by scripts/seed-local.ts',
        createdAt: now,
    });

    console.log('\n✅ Seed complete. Test users, membership, wallet, loan product, products, notification.\n');
}

main().catch(e => fail(e?.message || String(e)));
