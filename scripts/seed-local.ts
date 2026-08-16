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

/**
 * The identities every spec logs in as (see e2e/helpers/auth.ts).
 *
 * THE MODULE PERSONAS USED TO BE PRODUCTION ACCOUNTS. e2e/helpers/auth.ts
 * hardcoded marketplaceuser04@gmail.com, academyuser02@gmail.com,
 * cooperativeuser02@gmail.com, waveuser02@gmail.com and
 * exportwindowuser@gmail.com with their real passwords, so the suite could only
 * ever pass against production and seven specs timed out on a local stack.
 * They are seeded here instead.
 *
 * `modules` drives serviceRegistrations, which is what getPostLoginRedirect
 * reads to send a user to their module dashboard: exactly one approved module
 * means a direct landing there, none means the generic hub at /dashboard. The
 * status must be 'approved' or 'active' — those are the two that function
 * accepts.
 */
const USERS = [
    { key: 'user',   email: process.env.TEST_USER_EMAIL   || 'e2e.user@easysalesexport.com',   password: process.env.TEST_USER_PASSWORD   || 'E2eTest@2024!',   roles: ['member'],                          name: 'E2E Member',      modules: ['cooperatives'] },
    { key: 'admin',  email: process.env.TEST_ADMIN_EMAIL  || 'e2e.admin@easysalesexport.com',  password: process.env.TEST_ADMIN_PASSWORD  || 'E2eAdmin@2024!',  roles: ['admin', 'super_admin'],            name: 'E2E Admin',       modules: [] },
    { key: 'buyer',  email: process.env.TEST_BUYER_EMAIL  || 'e2e.buyer@easysalesexport.com',  password: process.env.TEST_BUYER_PASSWORD  || 'E2eBuyer@2024!',  roles: ['member', 'buyer'],                 name: 'E2E Buyer',       modules: ['marketplace'] },
    // The seller also owns the seeded land listings and is the persona the
    // "seller can list a new property" spec drives, so it needs farmNation
    // too — without it the listing form redirects to /farm-nation/onboarding.
    { key: 'seller', email: process.env.TEST_SELLER_EMAIL || 'e2e.seller@easysalesexport.com', password: process.env.TEST_SELLER_PASSWORD || 'E2eSeller@2024!', roles: ['member', 'seller', 'land_owner'],  name: 'E2E Seller',      modules: ['marketplace', 'farmNation'] },
    { key: 'academy', email: process.env.TEST_ACADEMY_EMAIL || 'e2e.academy@easysalesexport.com', password: process.env.TEST_ACADEMY_PASSWORD || 'E2eAcademy@2024!', roles: ['member', 'academy_participant'], name: 'E2E Academy',  modules: ['academy'] },
    { key: 'cooperative', email: process.env.TEST_COOPERATIVE_EMAIL || 'e2e.cooperative@easysalesexport.com', password: process.env.TEST_COOPERATIVE_PASSWORD || 'E2eCoop@2024!', roles: ['member', 'cooperative_member'], name: 'E2E Cooperative', modules: ['cooperatives'] },
    { key: 'wave',   email: process.env.TEST_WAVE_EMAIL   || 'e2e.wave@easysalesexport.com',   password: process.env.TEST_WAVE_PASSWORD   || 'E2eWave@2024!',   roles: ['member', 'wave_participant'],      name: 'E2E Wave',        modules: ['wave'] },
    { key: 'export', email: process.env.TEST_EXPORT_EMAIL || 'e2e.export@easysalesexport.com', password: process.env.TEST_EXPORT_PASSWORD || 'E2eExport@2024!', roles: ['member', 'export_participant'],    name: 'E2E Export',      modules: ['export'] },
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
        // getPostLoginRedirect accepts 'approved' or 'active' and nothing else,
        // and sends a user with exactly one approved module straight to that
        // module's dashboard. A persona with no modules lands on the generic
        // hub, which is what the RBAC and hub specs expect.
        //
        // `plan` matters for academy and nowhere else: the course catalogue
        // filters every card through checkCourseAccess(userPlan, course.tier),
        // read from serviceRegistrations.academy.plan. Without it the plan is
        // "free", every paid-tier course is filtered out, and the page renders
        // an empty catalogue that looks like a broken query. 'elite' so the
        // persona can reach every tier.
        serviceRegistrations: Object.fromEntries(
            u.modules.map(m => [m, {
                status: 'approved',
                registeredAt: now,
                paymentStatus: 'completed',
                ...(m === 'academy' ? { plan: 'elite' } : {}),
            }])
        ),
        // The seller specs need an approved seller; this is the flag
        // /api/marketplace/create-product checks.
        ...(u.key === 'seller' ? { sellerVerificationStatus: 'approved', businessName: 'E2E Seller Ltd' } : {}),
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

    // The cooperative persona needs its own membership — auth-module-access
    // logs in as this user and lands on /cooperatives/dashboard, which the
    // member layout guards on a membership record existing.
    const { error: coopMemErr } = await admin.from('cooperative_members').upsert({
        id: ids.cooperative,
        user_id: ids.cooperative,
        status: 'active',
        raw_data: {
            id: ids.cooperative, userId: ids.cooperative,
            firstName: 'E2E', lastName: 'Cooperative',
            membershipStatus: 'active', paymentStatus: 'completed',
            tier: 'Member', totalContributions: 60000, savingsBalance: 60000,
            cooperativeId: 'default', memberNumber: 'E2E-0002',
            joinedAt: now, createdAt: now, updatedAt: now,
        },
    }, { onConflict: 'id' });
    if (coopMemErr) fail(`cooperative_members (cooperative persona): ${coopMemErr.message}`);

    // Loan product with the confirmed terms: 10% MONTHLY, max 12 months.
    await doc('loan_products', 'e2e-loan-product', {
        name: 'E2E Cooperative Loan', description: 'Seeded for e2e runs',
        interestRate: 10, durationMonths: 12,
        minAmount: 5000, maxAmount: 500000,
        isActive: true, createdAt: now,
    });

    // A pending loan application, so the admin approval queue has a row to
    // render. Without one the admin spec waits for a <table> that the empty
    // state never draws — a fixture gap that reads as a broken page.
    // Belongs to the `cooperative` persona so it does not block the `user`
    // persona's own application flow: claimSingleOpenLoanApplication refuses a
    // second open application per borrower, by design.
    await doc('cooperative_loans', 'e2e-pending-loan', {
        memberId: ids.cooperative, userId: ids.cooperative,
        productId: 'e2e-loan-product', productName: 'E2E Cooperative Loan',
        amount: 20000, purpose: 'Seeded pending application for the approval queue',
        interestRate: 10, durationMonths: 12,
        monthlyPayment: 2935, interestAmount: 15220, totalRepayment: 35220,
        status: 'pending',
        guarantorName: 'E2E Guarantor', guarantorPhone: '+2348000000001',
        appliedAt: now, createdAt: now, updatedAt: now,
    });

    // Academy courses. getCoursesAction reads academy_courses ordered by
    // createdAt with no status filter, so any row shows up in the catalogue.
    //
    // `modules` MUST BE AN ARRAY OF MODULES, each with a `lessons` array.
    //
    // The Course type in src/types/index.ts declares `modules?: number`, and
    // seeding it that way — following the type — made the course DETAIL page
    // throw on render: it does `course.modules.reduce((sum, mod) => sum +
    // mod.lessons.length, 0)` before any conditional, so a number produces
    // "reduce is not a function" and the page renders nothing at all. The
    // catalogue page, which never touches the field, was fine.
    //
    // The type and the page disagree, and the page is what runs. Worth
    // correcting in the type, but the fixture has to match the consumer.
    //
    // `tier` also matters: the catalogue filters every card through
    // checkCourseAccess(userPlan, course.tier), so a tier the persona's plan
    // cannot reach is silently dropped from the list.
    for (let i = 1; i <= 2; i++) {
        await doc('academy_courses', `e2e-course-${i}`, {
            title: `E2E Export Fundamentals ${i}`,
            description: 'Seeded for e2e runs. Covers the basics of agro-export documentation.',
            instructor: 'E2E Instructor',
            duration: '4 weeks',
            modules: [
                {
                    id: `e2e-course-${i}-m1`,
                    title: 'Getting Started',
                    description: 'Orientation and paperwork',
                    lessons: [
                        { id: `e2e-course-${i}-m1-l1`, title: 'Welcome', duration: '5 min', content: 'Seeded lesson content.' },
                        { id: `e2e-course-${i}-m1-l2`, title: 'Export basics', duration: '12 min', content: 'Seeded lesson content.' },
                    ],
                },
                {
                    id: `e2e-course-${i}-m2`,
                    title: 'Documentation',
                    description: 'Certificates and customs',
                    lessons: [
                        { id: `e2e-course-${i}-m2-l1`, title: 'Certificates of origin', duration: '9 min', content: 'Seeded lesson content.' },
                    ],
                },
            ],
            price: 0,
            currency: 'NGN',
            category: 'export',
            level: 'beginner',
            tier: 'foundation',
            enrollmentCount: 0, enrolledCount: 0, rating: 0,
            status: 'open',
            createdAt: now, updatedAt: now,
        });
    }

    // Farm Nation land listings. getPublicLandListings filters on
    // `status == "verified"` and orders by createdAt, and the browse page
    // renders its empty state — not the property grid — when none match.
    for (let i = 1; i <= 2; i++) {
        await doc('land_listings', `e2e-listing-${i}`, {
            title: `E2E Farmland Plot ${i}`,
            description: 'Seeded for e2e runs. Arable land with road access.',
            location: { state: 'Plateau', lga: 'Jos North', address: `Plot ${i}, Jos` },
            size: 5, sizeInAcres: 5,
            price: 2_500_000 * i, totalPrice: 2_500_000 * i,
            category: 'farmland', propertyType: 'farmland', listingType: 'sale',
            soilType: 'loamy', waterSource: 'borehole',
            waterAccess: true, electricity: true, roadAccess: true,
            images: [],
            ownerId: ids.seller, ownerName: 'E2E Seller',
            // "verified" is the only status the public browse query accepts.
            status: 'verified', verificationStatus: 'verified',
            createdAt: now, updatedAt: now,
        });
    }

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
