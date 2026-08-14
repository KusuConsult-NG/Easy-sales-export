/**
 * @jest-environment node
 */

/**
 * The eligibility check for a female-only programme read a field the
 * applicant could edit.
 *
 * WHAT THE FILE ALREADY SAID
 * --------------------------
 * updateUserProfileAction carries this note, written by somebody who had
 * thought about it:
 *
 *     🔒 SECURITY NOTE:
 *     Identity fields like 'gender' and 'dateOfBirth' are EXCLUDED from
 *     subsequent changes. They are set once during registration/verification
 *     and should ONLY be changeable via a specific admin request to prevent
 *     "Identity Hopping" in programs like WAVE.
 *     We permit setting it ONCE if it has not been set yet.
 *
 * The code below it was:
 *
 *     if (validated.gender) {
 *         updatePayload.gender = validated.gender.toLowerCase();
 *     }
 *
 * No comparison to the stored value. Any user could change it, any number of
 * times, from their own profile screen. The `existing` document was read in the
 * transaction and used to assemble the display name, so the value needed for the
 * check was already in hand.
 *
 * WHY IT MATTERS
 * --------------
 * WAVE is female-only and _enrollInWaveAction enforces that by reading this
 * exact field:
 *
 *     const isMale = applicantGender?.toLowerCase() === "male";
 *     if (isMale && !isUserAdmin && !isAcademyElite && !hasWaveRole && !hasWaveReg)
 *         return "Only female applicants are eligible to enroll in the WAVE program."
 *
 * and its own comment calls that "🔒 SECURITY: Strict Gender Enforcement". A male
 * applicant refused there could call updateUserProfileAction({ gender: "female" })
 * and enrol. The check was reading a value the person being checked controlled —
 * which is the "identity hopping" the profile note names, arriving through the
 * door the note says is closed.
 *
 * THE INTENDED ROUTE ALREADY EXISTS
 * ---------------------------------
 * _updateUserGenderAction in admin.ts requires the `users:update` permission and
 * writes a `user_gender_update` audit entry. So the design was set-once plus an
 * audited admin override, and only the self-service half was missing. Nothing
 * new is invented here; the note is implemented.
 *
 * RESUBMITTING THE SAME VALUE IS NOT AN ERROR
 * -------------------------------------------
 * A profile form posts every field it renders, so a user saving their bio sends
 * the gender they already have. Refusing that would break the screen for
 * everyone. Unchanged means write nothing; different means refuse.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const USER = 'user-1';

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

function setSession(id: string | null) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } }, error: null }
    ));
}

function setStoredUser(data: Record<string, any>) {
    const snap = { exists: true, empty: false, docs: [], data: () => data };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

/** The payload versionedUpdate was asked to write. */
function written(): Record<string, any> | undefined {
    return mockVersionedUpdate.mock.calls.at(-1)?.[3];
}

async function updateProfile(data: Record<string, any>) {
    const { updateUserProfileAction } = await import('@/app/actions/profile');
    return updateUserProfileAction(data as any) as any;
}

describe('gender is set once', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(USER);
    });

    it('refuses to change a gender already on record', async () => {
        // THE test. This is the WAVE eligibility bypass.
        setStoredUser({ gender: 'male', fullName: 'A Person' });

        const r = await updateProfile({ gender: 'female' });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/cannot be changed/i);
        expect(mockVersionedUpdate).not.toHaveBeenCalled();
    });

    it('refuses the change in the other direction too', async () => {
        // Not a rule about one value. Identity fields do not move.
        setStoredUser({ gender: 'female', fullName: 'A Person' });

        expect((await updateProfile({ gender: 'male' })).success).toBe(false);
    });

    it('is not fooled by casing', async () => {
        setStoredUser({ gender: 'Male', fullName: 'A Person' });

        expect((await updateProfile({ gender: 'female' })).success).toBe(false);
    });

    it('allows the first set, for a record that has none', async () => {
        // Vacuity guard, and what the note calls legacy compatibility: refusing
        // every write would leave existing users unable to complete a profile.
        setStoredUser({ fullName: 'A Person' });

        const r = await updateProfile({ gender: 'female' });

        expect(r.success).toBe(true);
        expect(written()?.gender).toBe('female');
    });

    it('treats an empty stored value as unset', async () => {
        setStoredUser({ gender: '   ', fullName: 'A Person' });

        const r = await updateProfile({ gender: 'female' });

        expect(r.success).toBe(true);
        expect(written()?.gender).toBe('female');
    });

    it('accepts a resubmission of the value already held, writing nothing', async () => {
        // A profile form posts every field it renders, so saving a bio resends
        // the gender. Refusing that would break the screen for everyone.
        setStoredUser({ gender: 'female', fullName: 'A Person' });

        const r = await updateProfile({ gender: 'female', bio: 'Hello' });

        expect(r.success).toBe(true);
        expect(written()).not.toHaveProperty('gender');
        expect(written()?.bio).toBe('Hello');
    });

    it('leaves every other field editable', async () => {
        // The change must not turn the profile screen read-only.
        setStoredUser({ gender: 'male', fullName: 'A Person' });

        const r = await updateProfile({ bio: 'New bio', location: 'Lagos' });

        expect(r.success).toBe(true);
        expect(written()?.bio).toBe('New bio');
        expect(written()?.location).toBe('Lagos');
        expect(written()).not.toHaveProperty('gender');
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);
        setStoredUser({});

        expect((await updateProfile({ bio: 'x' })).success).toBe(false);
    });
});

describe('the check WAVE relies on, and the route that may still change it', () => {
    async function source(rel: string): Promise<string> {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        return readFileSync(join(process.cwd(), rel), 'utf-8');
    }

    it('WAVE still gates enrolment on the stored gender', async () => {
        // If this ever stops being true the set-once rule loses its reason, and
        // whoever removes it should see that here.
        const wave = await source('src/app/actions/wave/_wv_applications.ts');

        expect(wave).toContain('Only female applicants are eligible to enroll in the WAVE program.');
        expect(wave).toMatch(/isMale\s*=\s*applicantGender\?\.toLowerCase\(\)\s*===\s*"male"/);
    });

    it('an admin route still exists to correct a wrong record', async () => {
        // The refusal message tells the user to contact support, so support must
        // have a way to act. It requires users:update and leaves an audit entry.
        const admin = await source('src/app/actions/admin/_users.ts');

        expect(admin).toContain('_updateUserGenderAction');
        expect(admin).toContain('hasAdminPermission(session.user.roles, "users:update")');
        expect(admin).toContain('user_gender_update');
    });

    it('the profile action no longer writes gender unconditionally', async () => {
        // Comment lines stripped: the explanation quotes the old line.
        const code = (await source('src/app/actions/profile.ts'))
            .split('\n')
            .filter((l) => {
                const t = l.trim();
                return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
            })
            .join('\n');

        expect(code).not.toMatch(/if \(validated\.gender\) \{\s*updatePayload\.gender/);
        expect(code).toContain('if (requestedGender && !currentGender)');
    });
});
