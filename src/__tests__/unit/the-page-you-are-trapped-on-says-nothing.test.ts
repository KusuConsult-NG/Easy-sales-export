/**
 * @jest-environment node
 */

/**
 *   #529 THE GATE ON THE WHOLE PLATFORM WAS OPENED BY A SAVE THAT CHECKED
 *        NOTHING, AND THE PAGE IT LOCKED PEOPLE ONTO TOLD THEM NOTHING.
 *
 *   Reported by the owner: "when a user logs into his profile, the User is
 *   redirected to profile and from the profile the user can't click on the
 *   dashboard until they fill the blank fields and save, why? from the profile
 *   there is no logout button".
 *
 *   The mechanism, traced end to end:
 *
 *       dashboard/layout.tsx        await requireHubRegistration()
 *       hub-guard.ts:114            admits only profileComplete === true
 *       api/auth/register:199       writes profileComplete: false
 *       hub/register/page.tsx       redirect("/profile?notice=complete-…")
 *
 *   So a new member is bounced from their own dashboard to /profile. Three
 *   things then made that a trap rather than a step.
 *
 * ── ONE: THE PAGE NEVER SAID WHY ────────────────────────────────────────────
 *
 *   `const notice = searchParams.get('notice')` sat at line 31, and its ONLY
 *   two uses were clearing the query string and redirecting after a save.
 *   Nothing rendered it. The member landed on an ordinary-looking profile screen
 *   with no statement of why their dashboard had refused them, and no list of
 *   what to fill in. "Why?" is the owner's own question, asked of the software.
 *
 * ── TWO: THE DASHBOARD BUTTON BOUNCED SILENTLY ──────────────────────────────
 *
 *   The header rendered an enabled `← Dashboard` button doing an unconditional
 *   router.push("/dashboard"). For exactly the member the hub guard had just
 *   sent here, that push hits the layout guard, redirects to /hub/register,
 *   which redirects back to /profile. Visible, clickable, and does nothing —
 *   which is precisely what "can't click on the dashboard" describes.
 *
 * ── THREE: THERE WAS NO WAY OUT ─────────────────────────────────────────────
 *
 *   /profile is listed in ClientLayout's NON_MEMBER_PREFIXES, so the
 *   ModuleSidebar — the only member-facing sign-out on the platform — is
 *   deliberately not rendered on it. `signOut` is imported by the profile page
 *   and used on the email-change path alone. So a member with an incomplete
 *   profile could not reach the dashboard, could not reach any module, and had
 *   no visible way to sign out. Locked in.
 *
 * ── AND THE GATE ITSELF WAS NOT A GATE ──────────────────────────────────────
 *
 *   Found while tracing the above, and it is the more serious half. Every field
 *   in profileUpdateSchema is `.optional()`, and the writer did
 *
 *       const updatePayload = { ...validated, profileComplete: true };
 *
 *   unconditionally. A server action is a POST endpoint — the browser form is
 *   not its only caller — so updateUserProfileAction({}) opened the dashboard
 *   and every module on a profile with no name, no email and no phone number.
 *
 *   The rule that was meant to stop that DID exist, in the browser: handleSave
 *   refuses a blank phone, and refuses a non-Nigerian number with no government
 *   ID. This audit's most repeated finding, at its most consequential: the rule
 *   reached one of its doors, and the door it reached was the one nobody has to
 *   use.
 *
 * ── WHAT IS DELIBERATELY NOT DONE ───────────────────────────────────────────
 *
 *   NOBODY IS DOWNGRADED. nextProfileCompleteFlag returns true unchanged for any
 *   row that already holds true, whatever its fields look like. There are
 *   ~42,000 profiles in production and many were written by importers and
 *   backfills rather than by this form (profile-provenance.ts), so recomputing
 *   the flag downwards on their next save would lock out members who have been
 *   using the platform for months. #485's constraint: onboarding and selling
 *   must not stop. The defect is a fresh account getting IN, and the one-way
 *   rule closes it without touching anybody already through.
 *
 *   THE SAVE STILL SUCCEEDS WHEN SOMETHING IS MISSING. Refusing a partial save
 *   would be worse than the defect — a member filling a long form over two
 *   sittings would lose the first. What changed is that the gate is not opened
 *   by it, and the caller is told what remains.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     profileComplete written unconditionally again   KILLED
 *     the never-downgrade rule removed                KILLED
 *     the name rule dropped                           KILLED
 *     the non-Nigerian ID rule dropped                KILLED
 *     the banner un-rendered                          KILLED
 *     the dashboard button re-enabled                 KILLED
 *     the logout button removed                       KILLED
 *     reword this header                              SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    missingProfileFields,
    isProfileComplete,
    nextProfileCompleteFlag,
    isNonNigerianPhone,
} from '@/lib/profile-completeness';

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

/**
 * The harness the two existing profile suites use.
 *
 * updateUserProfileAction writes through versionedUpdate inside a transaction
 * and then invalidates a cache and syncs the auth email; none of those three
 * work under the fake, and a throw in any of them lands in withSafeAction's
 * catch and comes back as "A temporary connection issue occurred" — which is
 * what a first version of this file measured, and it looked exactly like a
 * defect in the code under test. Mocking them is what
 * profile-gender-set-once.test.ts and
 * saving-your-profile-cannot-duplicate-your-name.test.ts already do, and it has
 * the side benefit that the assertions below read the PAYLOAD rather than the
 * stored row — which is the thing the finding is actually about.
 */
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
}));
jest.mock('@/lib/auth-revocation', () => ({
    syncAuthEmail: jest.fn(async () => ({ primaryRevoked: true, error: null })),
    revokeAuthAccess: jest.fn(async () => ({ primaryRevoked: true })),
}));

const mockVersionedUpdate = jest.fn(async () => ({})) as jest.Mock<any>;
jest.mock('@/lib/optimistic-locking', () => ({
    versionedUpdate: (...a: any[]) => mockVersionedUpdate(...a),
}));

/** What the action would write. */
const written = (): Record<string, any> => (mockVersionedUpdate.mock.calls[0]?.[3] ?? {}) as any;

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: p });

const PAGE = 'src/app/profile/page.tsx';
const WRITER = 'src/app/actions/profile.ts';

const MEMBER = 'member-1';
let store: FakeDbHandle;

const COMPLETE = {
    firstName: 'Ada',
    lastName: 'Obi',
    email: 'ada@example.com',
    phone: '+2348030000001',
};

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    store = installFakeDb();
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: MEMBER, roles: ['general_user'], email: 'ada@example.com' } },
        error: null,
    }));
});

const save = async (fields: Record<string, unknown>) => {
    const { updateUserProfileAction } = await import('@/app/actions/profile');
    return (await updateUserProfileAction(fields as any)) as any;
};


// ─────────────────────────────────────────────────────────────────────────────
describe('#529 — the empty save no longer opens the platform', () => {
    it('AN EMPTY SAVE DOES NOT SET profileComplete', async () => {
        //   THE test. `{ ...validated, profileComplete: true }` was
        //   unconditional, and every field in the schema is optional, so this
        //   exact call admitted the caller to the dashboard and every module.
        store.seed(COLLECTIONS.USERS, MEMBER, { profileComplete: false });

        const res = await save({});

        expect(res.success).toBe(true);
        expect(written().profileComplete).toBe(false);
    });

    it('AND A HALF-FILLED ONE DOES NOT EITHER', async () => {
        store.seed(COLLECTIONS.USERS, MEMBER, { profileComplete: false });

        await save({ firstName: 'Ada' });

        expect(written().profileComplete).toBe(false);
    });

    it('AND A COMPLETE ONE DOES', async () => {
        //   The vacuity guard. A fix that never opened the gate would satisfy
        //   both assertions above and lock every new member out for ever.
        store.seed(COLLECTIONS.USERS, MEMBER, { profileComplete: false });

        const res = await save(COMPLETE);

        expect(res.success).toBe(true);
        expect(written().profileComplete).toBe(true);
    });

    it('AND THE SAVE STILL SUCCEEDS AND STILL WRITES WHAT WAS SENT', async () => {
        //   Refusing a partial save would lose the work of a member filling a
        //   long form in two sittings. That is worse than the defect.
        store.seed(COLLECTIONS.USERS, MEMBER, { profileComplete: false });

        const res = await save({ firstName: 'Ada' });

        expect(res.success).toBe(true);
        expect(written().firstName).toBe('Ada');
    });

    it('AND IT REPORTS WHAT IS STILL MISSING', async () => {
        //   So the screen can say it. The action used to return data: null and
        //   the member found out by being bounced again.
        store.seed(COLLECTIONS.USERS, MEMBER, { profileComplete: false });

        const res = await save({ firstName: 'Ada', lastName: 'Obi' });

        expect(res.data.missing.map((m: any) => m.field).sort()).toEqual(['email', 'phone']);
    });

    it('and NOBODY ALREADY THROUGH THE GATE IS PUT BACK OUTSIDE IT', async () => {
        //   The load-bearing exclusion. ~42,000 production profiles were written
        //   by importers rather than this form; recomputing downwards would lock
        //   out members who have been using the platform for months.
        store.seed(COLLECTIONS.USERS, MEMBER, { profileComplete: true });

        await save({ bio: 'Farmer' });

        expect(written().profileComplete).toBe(true);
    });

    it('and the writer no longer states the flag as a literal', () => {
        //   Comments stripped: the fix quotes the old expression to explain it.
        expect(code(WRITER)).not.toContain('profileComplete: true');
        expect(code(WRITER)).toContain('nextProfileCompleteFlag(');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#529 — the rule, which used to live in a click handler', () => {
    it('A NAME IS TWO PARTS, HOWEVER THE ROW SPELLS IT', () => {
        expect(isProfileComplete({ ...COMPLETE })).toBe(true);
        expect(isProfileComplete({ ...COMPLETE, firstName: '', lastName: '', fullName: 'Ada Obi' })).toBe(true);
        expect(isProfileComplete({ ...COMPLETE, firstName: '', lastName: '', name: 'Ada Obi' })).toBe(true);
    });

    it('AND ONE PART IS NOT A NAME', () => {
        //   "Ada" alone cannot go on an ID card or a certificate.
        expect(isProfileComplete({ ...COMPLETE, firstName: 'Ada', lastName: '' })).toBe(false);
    });

    it('AND THE NON-NIGERIAN ID RULE SURVIVED THE MOVE OUT OF THE BROWSER', () => {
        //   handleSave: "Government Issued ID is required for non-Nigerians."
        //   It was enforced in the page and by nothing on the server.
        const abroad = { ...COMPLETE, phone: '+447700900000' };

        expect(isProfileComplete(abroad)).toBe(false);
        expect(isProfileComplete({ ...abroad, identityDocument: 'https://res.cloudinary.com/x/id.pdf' })).toBe(true);
    });

    it('AND A LOCAL NIGERIAN NUMBER IS NOT TREATED AS FOREIGN', () => {
        //   `08030000001` is how a Nigerian member writes their own number.
        //   Reading it as international would demand an ID from the people this
        //   platform is built for — the fix breaking onboarding.
        expect(isNonNigerianPhone('08030000001')).toBe(false);
        expect(isNonNigerianPhone('+2348030000001')).toBe(false);
        expect(isNonNigerianPhone('+447700900000')).toBe(true);
        expect(isProfileComplete({ ...COMPLETE, phone: '08030000001' })).toBe(true);
    });

    it('and the missing list is ordered the way the form is filled', () => {
        expect(missingProfileFields({}).map((m) => m.field)).toEqual(['name', 'email', 'phone']);
    });

    it('and the flag is never downgraded, stated at the rule', () => {
        expect(nextProfileCompleteFlag(true, {})).toBe(true);
        expect(nextProfileCompleteFlag(false, {})).toBe(false);
        expect(nextProfileCompleteFlag(undefined, COMPLETE)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#529 — the page says why, and offers a way out', () => {
    const page = () => code(PAGE);

    it('THE REASON IS RENDERED, NOT JUST READ FROM THE URL', () => {
        //   `notice` was read on line 31 and used only to clear the query string
        //   and to redirect after a save. Nothing displayed it.
        const src = page();

        expect(src).toContain('missingProfileFields(');
        expect(src).toContain('Finish your profile to open your dashboard');
        expect(src).toContain('{missing.length > 0 && (');
    });

    it('AND THE DASHBOARD BUTTON NO LONGER BOUNCES SILENTLY', () => {
        //   It was an unconditional router.push onto a route the hub guard
        //   refuses, which redirects back here.
        const src = page();
        const button = src.slice(src.indexOf('← Dashboard') - 900, src.indexOf('← Dashboard'));

        expect(button).toContain('disabled={profileComplete === false}');
        expect(button).toContain('title=');
    });

    it('AND THERE IS A SIGN-OUT ON THE PAGE AT LAST', () => {
        //   /profile is in ClientLayout's NON_MEMBER_PREFIXES, so the sidebar
        //   that carries the only member-facing sign-out is not rendered here.
        expect(page()).toContain('<HardLogoutButton');
    });

    it('AND IT REUSES THE ONE THE ERROR PAGES USE', () => {
        //   Not a fourth signOut call site. HardLogoutButton also clears the
        //   client state (#337) behind the login loop this member is most
        //   likely to hit next.
        expect(page()).toContain('from "@/components/auth/HardLogoutButton"');
    });

    it('and /profile really is a page with no sidebar, which is why this was needed', () => {
        //   The premise, measured rather than asserted. If the sidebar were
        //   rendered here the member would have had a sign-out all along.
        expect(code('src/components/layout/ClientLayout.tsx')).toContain('"/profile"');
    });

    it('and the post-save redirect only fires when it will actually land', () => {
        //   Pushing an incomplete profile at /dashboard is the loop itself.
        expect(page()).toContain("notice === 'complete-your-hub-registration' && remaining.length === 0");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#529 — one rule, three readers', () => {
    it('THE GUARD, THE WRITER AND THE SCREEN ALL ASK THE SAME MODULE', () => {
        //   The ratchet. The rule existed in three disagreeing places: the guard
        //   read a boolean, the writer set it blind, the page checked two fields
        //   in a click handler.
        expect(code(WRITER)).toContain('@/lib/profile-completeness');
        expect(code(PAGE)).toContain('@/lib/profile-completeness');
        expect(code('src/lib/hub-guard.ts')).toContain('profileComplete === true');
    });

    it('AND NO OTHER FILE SETS THE FLAG TRUE BY HAND', () => {
        //   Registration writes `false` and the seeder writes `true` for an
        //   account it provisions in full; neither is a member self-service
        //   path. What must not reappear is a second writer flipping it on a
        //   save, which is the defect.
        const body = code(WRITER);
        expect([...body.matchAll(/profileComplete/g)].length).toBeGreaterThan(0);
        expect(body).not.toMatch(/profileComplete:\s*true/);
    });

    it('AND THE FILES READ ARE REAL', () => {
        //   #484's shape — a control that reads as present and is none.
        for (const f of [PAGE, WRITER, 'src/lib/profile-completeness.ts', 'src/lib/hub-guard.ts']) {
            expect(code(f).length).toBeGreaterThan(500);
        }
    });
});
