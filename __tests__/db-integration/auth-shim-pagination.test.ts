/**
 * The authentication shim, against a real auth store.
 *
 * src/lib/shims/firebase-admin is what `firebase-admin` resolves to (see
 * package.json), so this file is the authentication layer, not a test double.
 *
 * WHAT WAS WRONG
 * --------------
 * Every read went through `supabaseAdmin.auth.admin.listUsers()` with no
 * pagination arguments. GoTrue returns 50 rows by default. With ~41,000
 * accounts in production that is 0.1% of the store, returned as if it were all
 * of it:
 *
 *   getUserByEmail()   threw "auth/user-not-found" for all but the oldest 50
 *   listUsers(n, tok)  ignored both arguments and always returned
 *                      pageToken: undefined, so every caller's do/while paging
 *                      loop finished after one page
 *   getUsers()         did not exist; broadcast-logic.ts calls it four times
 *   user records       had no `metadata`, which orphaned-user-repair.ts reads
 *
 * The user-visible one is password reset. password-reset.ts:76 calls
 * getUserByEmail inside a try, and on a throw returns { success: true } without
 * sending anything — deliberately, so the response cannot be used to discover
 * which addresses are registered. So for nearly every account, requesting a
 * password reset produced a confirmation screen and no email, with nothing in
 * the logs to say otherwise.
 *
 * None of it could be caught by the compiler: auth.d.ts said
 * `export type Auth = any`.
 *
 * WHY THE SEED IS 120 ACCOUNTS
 * ----------------------------
 * The bug is invisible below 51. A test seeding a handful of users passes
 * against the broken code and proves nothing — the vacuity failure this whole
 * suite exists to avoid. 120 crosses the boundary with room to spare, and the
 * lookups below deliberately target accounts created LAST.
 */

import { getAdminAuth } from '@/lib/firebase-admin';

declare const maybeDescribe: jest.Describe;

const auth: any = getAdminAuth();

/** Comfortably past GoTrue's 50-row default page. */
const SEEDED = 120;
const PREFIX = 'jest-authshim-';

/** uid by seed index, so a test can name the account created last. */
const created: string[] = [];

async function purge() {
    // Page through rather than calling listUsers() once — the very bug under
    // test would leave most of the fixtures behind.
    for (let page = 1; page <= 20; page++) {
        const res = await auth.listUsers(1000, String(page));
        const mine = res.users.filter((u: any) => u.email?.startsWith(PREFIX));
        for (const u of mine) {
            try { await auth.deleteUser(u.uid); } catch { /* already gone */ }
        }
        if (!res.pageToken) break;
    }
}

maybeDescribe('firebase-admin auth shim: pagination and the missing methods', () => {
    beforeAll(async () => {
        await purge();
        for (let i = 0; i < SEEDED; i++) {
            const rec = await auth.createUser({
                email: `${PREFIX}${String(i).padStart(3, '0')}@jest.local`,
                password: 'JestAuth@2024!',
                displayName: `Auth Shim User ${i}`,
            });
            created.push(rec.uid);
        }
    }, 300000);

    afterAll(purge, 300000);

    it('finds an account created well past the first page', async () => {
        // THE ASSERTION THIS FILE EXISTS FOR. Account 119 is outside the first
        // 50 by creation order, so the old implementation threw
        // auth/user-not-found here — which is exactly what made password reset
        // silently do nothing.
        const email = `${PREFIX}119@jest.local`;
        const record = await auth.getUserByEmail(email);

        expect(record.uid).toBe(created[119]);
        expect(record.email).toBe(email);
    }, 120000);

    it('still reports a genuinely absent account as not found', async () => {
        // Without this, "return the first user you find" would pass the test
        // above.
        await expect(auth.getUserByEmail('nobody-at-all@jest.local'))
            .rejects.toMatchObject({ code: 'auth/user-not-found' });
    }, 120000);

    it('pages through every account with listUsers', async () => {
        // maxResults and pageToken were both ignored, and pageToken always came
        // back undefined, so this loop used to end after one page of 50.
        const seen = new Set<string>();
        let pageToken: string | undefined;
        let pages = 0;

        do {
            const res = await auth.listUsers(25, pageToken);
            expect(res.users.length).toBeLessThanOrEqual(25);
            res.users.forEach((u: any) => seen.add(u.uid));
            pageToken = res.pageToken;
            pages++;
        } while (pageToken && pages < 50);

        // More than one page was actually read — a single page returning
        // everything would satisfy the count below without paging working.
        expect(pages).toBeGreaterThan(1);
        for (const uid of created) {
            expect(seen.has(uid)).toBe(true);
        }
    }, 120000);

    it('honours maxResults instead of ignoring it', async () => {
        const res = await auth.listUsers(7);
        expect(res.users).toHaveLength(7);
        expect(res.pageToken).toBeDefined();
    }, 120000);

    it('getUsers returns records for known uids and does not throw on unknown ones', async () => {
        // broadcast-logic.ts calls this at four places to recover emails for
        // members whose profile row has none. It did not exist, so every call
        // threw and was swallowed by a catch that logged "Auth fallback error".
        //
        // Not throwing on a miss is part of the contract, not an accident: one
        // member without an auth record must not fail a batch of 100.
        const result = await auth.getUsers([
            { uid: created[0] },
            { uid: created[117] },
            { uid: '00000000-0000-0000-0000-000000000000' },
        ]);

        expect(result.users.map((u: any) => u.uid).sort())
            .toEqual([created[0], created[117]].sort());
        expect(result.notFound).toHaveLength(1);
    }, 120000);

    it('gives every record a metadata object', async () => {
        // orphaned-user-repair.ts:100 reads userRecord.metadata.creationTime.
        // `metadata` was not on the record at all, so that line threw at the
        // exact moment the scan found the orphan it was looking for.
        const res = await auth.listUsers(1);
        const record = res.users[0];

        expect(record.metadata).toBeDefined();
        expect(record.metadata.creationTime).toBeTruthy();
    }, 120000);

    it('actually suspends an account when told to disable it', async () => {
        // auth-revocation.ts:132 passes { disabled: true }. The shim accepted
        // the field and dropped it, so suspending an account did nothing.
        const uid = created[5];

        await auth.updateUser(uid, { disabled: true });
        expect((await auth.getUser(uid)).disabled).toBe(true);

        // And it must be reversible — a one-way switch would be a different
        // bug, not a fix.
        await auth.updateUser(uid, { disabled: false });
        expect((await auth.getUser(uid)).disabled).toBe(false);
    }, 120000);

    it('reports per-account outcomes from deleteUsers', async () => {
        // It returned { failureCount: 0, successes: n } unconditionally — no
        // successCount, and no errors array. scripts/auth-purge-orphans.ts adds
        // result.successCount to a running total (undefined, so NaN) and reads
        // err.error.message from result.errors (undefined, so a TypeError).
        const doomed = created[6];
        const result = await auth.deleteUsers([doomed]);

        expect(result.successCount).toBe(1);
        expect(result.failureCount).toBe(0);
        expect(Array.isArray(result.errors)).toBe(true);
    }, 120000);
});
