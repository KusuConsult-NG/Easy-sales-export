/**
 * Firebase Auth, reimplemented on Supabase Auth.
 *
 * package.json points `firebase-admin` at this directory, so every call the
 * application makes to Firebase Auth lands here. That makes this file the
 * authentication layer, not a test double, despite the class being called
 * MockAuth (kept, because renaming it is a separate change from fixing it).
 *
 * WHAT WAS WRONG — READ THIS BEFORE EDITING
 * ========================================
 * Every read method called `supabaseAdmin.auth.admin.listUsers()` with NO
 * pagination arguments. GoTrue's default page size is 50. So:
 *
 *   getUserByEmail()        searched the first 50 accounts and threw
 *                           "auth/user-not-found" for everybody else
 *   getUserByPhoneNumber()  the same
 *   listUsers(n, token)     ignored both arguments, returned 50 rows, and
 *                           returned pageToken: undefined so every caller's
 *                           do/while paging loop ended after one page
 *
 * With ~41,000 accounts in production that is 0.1% coverage, reported as a
 * complete answer. Measured, not inferred: 100 accounts seeded locally,
 * getUserByEmail found the 1st and threw auth/user-not-found on the 79th, and
 * listUsers() returned 50.
 *
 * What that broke, in the callers:
 *
 *   password-reset.ts:76   getUserByEmail throws → the action returns
 *                          { success: true } and sends nothing. Password reset
 *                          silently did nothing for all but the oldest 50
 *                          accounts, and the caller cannot tell, because the
 *                          "don't reveal whether the address exists" branch
 *                          looks exactly the same.
 *   password-reset.ts:285  the fallback that resolves an account's auth id
 *   api/auth/register:30   the duplicate-email check passed for everyone
 *   orphaned-user-repair   the scan stopped after 50 accounts and reported
 *                          "complete"
 *   forensics.ts:38        listUsers(100) returned 50
 *
 * getUsers() DID NOT EXIST AT ALL, and broadcast-logic.ts calls it at four
 * places to recover email addresses for members whose profile row has none.
 * Each call is inside a try/catch that logs "Auth fallback error", so a method
 * that has never existed looked like an intermittent Supabase problem, and
 * those members were quietly dropped from every email broadcast.
 *
 * User records also had no `metadata`, while orphaned-user-repair.ts:100 reads
 * `userRecord.metadata.creationTime` — a TypeError thrown at the exact moment
 * the scan finds the orphan it is looking for.
 *
 * None of this could be caught by the compiler: auth.d.ts declared
 * `export type Auth = any`, so a call to a method that does not exist, or a
 * read of a field that is not there, type-checked cleanly. auth.d.ts now
 * describes this class, so the next gap of this kind fails the build.
 */

try {
  global.WebSocket = require('ws');
} catch (e) {}

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseServiceKey || supabaseAnonKey || 'placeholder',
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        }
    }
);

/** GoTrue's maximum. Asking for more silently gets you this. */
const MAX_PER_PAGE = 1000;

/**
 * Runaway guard for the full-scan lookups below. 200 pages x 1000 = 200,000
 * accounts, comfortably above the ~41,000 in production.
 *
 * Reaching it means the answer is INCOMPLETE, so it is reported rather than
 * returned quietly — the failure being fixed here is precisely a truncated
 * scan that looked complete.
 */
const MAX_SCAN_PAGES = 200;

/** Supabase auth user -> the Firebase UserRecord shape callers expect. */
function toUserRecord(u) {
    return {
        uid: u.id,
        email: u.email,
        emailVerified: Boolean(u.email_confirmed_at),
        displayName: u.user_metadata?.full_name,
        phoneNumber: u.phone || undefined,
        disabled: Boolean(u.banned_until),
        // orphaned-user-repair.ts reads metadata.creationTime. It was absent,
        // so that read threw. Always an object, never undefined.
        metadata: {
            creationTime: u.created_at,
            lastSignInTime: u.last_sign_in_at,
        },
        customClaims: u.app_metadata || {},
    };
}

function notFoundError() {
    const err = new Error('User not found');
    err.code = 'auth/user-not-found';
    return err;
}

/**
 * Walk every page of the auth store, calling `match` on each user.
 *
 * The single mechanism the three lookups share. It exists because the previous
 * bug was three separate unpaginated calls, and three copies of a paging loop
 * would be three chances to leave one of them unpaginated again.
 *
 * COST: a full scan is one request per 1,000 accounts. For ~41,000 that is up
 * to 41 requests for a miss, and usually far fewer for a hit. That is the price
 * of correctness here; GoTrue's admin API offers no server-side filter for
 * these fields. If it becomes a problem, the fix is an indexed lookup, not a
 * smaller scan.
 */
async function scanUsers(match) {
    for (let page = 1; page <= MAX_SCAN_PAGES; page++) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: MAX_PER_PAGE });
        if (error) throw new Error(error.message);

        const users = data?.users || [];
        if (users.length === 0) return null;

        const hit = users.find(match);
        if (hit) return hit;

        // A short page is the last page.
        if (users.length < MAX_PER_PAGE) return null;
    }

    console.error(
        `[firebase-admin/auth] User scan hit the ${MAX_SCAN_PAGES}-page ceiling ` +
        `(${MAX_SCAN_PAGES * MAX_PER_PAGE} accounts). The result is INCOMPLETE — a matching ` +
        `account beyond that point will be reported as not found.`
    );
    return null;
}

class MockAuth {
  async createUser(params) {
    const { email, password, displayName, emailVerified } = params;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        // emailVerified was accepted by callers and ignored here; it happened
        // to match the hardcoded `true`, so nobody noticed. Honoured now, with
        // the same default, so passing `false` means something.
        email_confirm: emailVerified !== false,
        user_metadata: { full_name: displayName }
    });
    if (error) throw new Error(error.message);
    return toUserRecord(data.user);
  }

  async updateUser(uid, params) {
    const updateData = {};
    if (params.email) updateData.email = params.email;
    if (params.password) updateData.password = params.password;
    if (params.displayName) updateData.user_metadata = { full_name: params.displayName };

    // `disabled` was accepted and silently dropped. auth-revocation.ts:132
    // passes { disabled: true } to suspend an account, so suspension did
    // nothing here. Supabase expresses it as ban_duration; 'none' lifts it, so
    // `disabled: false` re-enables rather than being a no-op.
    if (params.disabled !== undefined) {
        updateData.ban_duration = params.disabled ? '876000h' : 'none';
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(uid, updateData);
    if (error) throw new Error(error.message);
    return toUserRecord(data.user);
  }

  async deleteUser(uid) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (error) throw new Error(error.message);
    return {};
  }

  async deleteUsers(uids) {
    // Reports what actually happened. It previously returned
    // { failureCount: 0, successes: uids.length } unconditionally, including
    // when every delete had failed — a caller checking failureCount was told
    // the purge succeeded when nothing had been removed.
    const errors = [];
    let successCount = 0;
    for (const uid of uids) {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
        if (error) {
            // Firebase's shape is { index, error }, and
            // scripts/auth-purge-orphans.ts:86 reads err.error.message. The
            // previous return value had no `errors` array at all, so that line
            // threw on the first failure — and no `successCount` either, so
            // `purgedCount += result.successCount` made the progress counter
            // NaN on every run.
            errors.push({ index: uids.indexOf(uid), error: new Error(error.message) });
        } else {
            successCount++;
        }
    }
    return { failureCount: errors.length, successCount, errors };
  }

  async getUserByEmail(email) {
    const target = String(email || '').toLowerCase();
    const user = await scanUsers(u => u.email?.toLowerCase() === target);
    if (!user) throw notFoundError();
    return toUserRecord(user);
  }

  async getUserByPhoneNumber(phone) {
    const user = await scanUsers(u => u.phone === phone);
    if (!user) throw notFoundError();
    return toUserRecord(user);
  }

  async getUser(uid) {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(uid);
    if (error) throw new Error(error.message);
    if (!data.user) throw notFoundError();
    return toUserRecord(data.user);
  }

  /**
   * Look up many accounts at once.
   *
   * DID NOT EXIST. broadcast-logic.ts calls it at lines 185, 298, 616 and 982.
   *
   * Firebase's contract, which the callers rely on: this does NOT throw for a
   * missing account — misses come back in `notFound`, and the caller iterates
   * `result.users`. Throwing instead would turn a member with no auth record
   * into a failure for the whole chunk of 100.
   *
   * Identifiers are looked up by uid one at a time (an indexed point read),
   * and only email/phone identifiers fall back to a scan. The callers pass
   * uids exclusively, so the common path stays cheap.
   */
  async getUsers(identifiers) {
    const list = Array.isArray(identifiers) ? identifiers : [];
    const users = [];
    const notFound = [];

    for (const identifier of list) {
        try {
            if (identifier?.uid) {
                const { data, error } = await supabaseAdmin.auth.admin.getUserById(identifier.uid);
                if (error || !data?.user) { notFound.push(identifier); continue; }
                users.push(toUserRecord(data.user));
            } else if (identifier?.email) {
                const target = String(identifier.email).toLowerCase();
                const hit = await scanUsers(u => u.email?.toLowerCase() === target);
                if (!hit) { notFound.push(identifier); continue; }
                users.push(toUserRecord(hit));
            } else if (identifier?.phoneNumber) {
                const hit = await scanUsers(u => u.phone === identifier.phoneNumber);
                if (!hit) { notFound.push(identifier); continue; }
                users.push(toUserRecord(hit));
            } else {
                notFound.push(identifier);
            }
        } catch (e) {
            // A single bad identifier must not fail the batch — that is the
            // whole reason Firebase reports misses instead of throwing.
            notFound.push(identifier);
        }
    }

    return { users, notFound };
  }

  /**
   * One page of accounts.
   *
   * Both arguments were ignored. maxResults now sets the page size, and
   * pageToken is the next page number as a string — opaque to callers, which
   * is all Firebase's contract requires. Returning a real token is what lets
   * the `do { ... } while (pageToken)` loops in orphaned-user-repair.ts and
   * auth-db-audit.ts reach past the first page, which they never did.
   */
  async listUsers(maxResults, pageToken) {
    const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(maxResults) || MAX_PER_PAGE));
    const page = Math.max(1, Number(pageToken) || 1);

    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);

    const users = (data?.users || []).map(toUserRecord);

    return {
        users,
        // A full page means there may be another. A short page is the end, and
        // an undefined token is how every caller's loop terminates.
        pageToken: users.length === perPage ? String(page + 1) : undefined,
    };
  }

  async createCustomToken(uid, claims) {
    return "mock-custom-token";
  }
}

module.exports = {
  getAuth: () => new MockAuth()
};
