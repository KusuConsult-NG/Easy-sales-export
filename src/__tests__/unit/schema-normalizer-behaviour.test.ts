/**
 * @jest-environment node
 */

/**
 * lib/schema-normalizer.ts, EXECUTED. It was at 16.1%.
 *
 *   #207 THE SELF-HEAL REVERSED A REJECTION, ON LOGIN, AND PERSISTED IT.
 *
 *        normalizeUserDoc synced roles to registration statuses:
 *
 *            if (roles.includes("wave_participant")) {
 *                if (sr.wave.status !== "approved") sr.wave.status = "approved";
 *            }
 *
 *        and it is called by session-guard on every uncached session resolution
 *        and by auth.ts on every login — both of which WRITE THE RESULT BACK
 *        with `set(normalized, { merge: true })`.
 *
 *        The WAVE rejection (wave/_wv_admin_applications.ts:437) and both
 *        Academy rejections (admin/_academy.ts:366,
 *        academy/_ac_admin_review.ts:213) write `status: "rejected"` and do NOT
 *        strip the corresponding role. So: an admin rejects an application, the
 *        applicant logs in, and the rejection is silently replaced with
 *        "approved" in the database. Farm Nation strips `farmer` on rejection
 *        but never `land_owner`, and the heal fires on either.
 *
 *        The cooperative was safe only by accident — its suspend path revokes
 *        the role, and that was fixed for a different reason entirely.
 *
 *        This is #180 inverted: there a repair tool DOWNGRADED live
 *        registrations, here a repair rule UPGRADED refused ones. A derived
 *        signal may fill in what is missing and must never overwrite a decision.
 *
 *   #208 THE TWO NORMALISERS DISAGREED ABOUT AN ALIAS.
 *        normalizeUserDoc writes `name` AND `fullName` from displayName;
 *        normalizeUserUpdate wrote only `name`. Two functions whose entire
 *        purpose is that the aliases agree, disagreeing about one of the
 *        aliases depending on which one you called.
 *
 *   #209 AND ONE OF THEM IGNORED A WHOLE-OBJECT WRITE.
 *        normalizeUserUpdate matched `startsWith("serviceRegistrations.
 *        cooperatives.")` — with a trailing dot — so a write of the entire
 *        registration under one spelling was not mirrored to the other. No
 *        caller writes that shape today, so this had no live victim; recorded
 *        and closed because a normaliser should not have a shape it silently
 *        skips.
 */

import { describe, it, expect } from '@jest/globals';
import { normalizeUserDoc, normalizeUserUpdate } from '@/lib/schema-normalizer';
import { isDecidedAgainst } from '@/lib/registration-progress';

const sr = (doc: any) => doc.serviceRegistrations;

// ─────────────────────────────────────────────────────────────────────────────
describe('#207 — a decision is never overwritten by a role', () => {
    it.each([
        ['wave_participant', 'wave'],
        ['academy_participant', 'academy'],
        ['farmer', 'farmNation'],
        ['land_owner', 'farmNation'],
        ['cooperative_member', 'cooperatives'],
    ])('KEEPS A REJECTION for %s / %s', (role, key) => {
        const out = normalizeUserDoc({
            roles: [role],
            serviceRegistrations: { [key]: { status: 'rejected', rejectionReason: 'incomplete' } },
        });

        // Was 'approved', written back to the database on the next login.
        expect(sr(out)[key].status).toBe('rejected');
        expect(sr(out)[key].rejectionReason).toBe('incomplete');
    });

    it.each(['suspended', 'revoked', 'declined', 'cancelled', 'banned', 'withdrawn', 'terminated'])(
        'keeps %s too', (status) => {
            const out = normalizeUserDoc({
                roles: ['wave_participant'],
                serviceRegistrations: { wave: { status } },
            });
            expect(sr(out).wave.status).toBe(status);
        });

    it('is case- and whitespace-insensitive about a decision', () => {
        const out = normalizeUserDoc({
            roles: ['wave_participant'],
            serviceRegistrations: { wave: { status: '  REJECTED ' } },
        });
        expect(sr(out).wave.status).toBe('  REJECTED ');
    });

    it('KEEPS THE REJECTION UNDER BOTH SPELLINGS of the farm nation key', () => {
        const out = normalizeUserDoc({
            roles: ['land_owner'],
            serviceRegistrations: { farmNation: { status: 'rejected' }, farm_nation: { status: 'rejected' } },
        });

        expect(sr(out).farmNation.status).toBe('rejected');
        expect(sr(out).farm_nation.status).toBe('rejected');
    });

    // ── and everything the heal was FOR still works ──────────────────────────

    it('still heals a legacy account: the role, and no registration at all', () => {
        const out = normalizeUserDoc({ roles: ['wave_participant'] });
        expect(sr(out).wave.status).toBe('approved');
    });

    it('still heals a registration recorded with no status', () => {
        const out = normalizeUserDoc({
            roles: ['academy_participant'],
            serviceRegistrations: { academy: { plan: 'elite' } },
        });
        expect(sr(out).academy).toMatchObject({ status: 'approved', plan: 'elite' });
    });

    it('still promotes a status that is merely less far along', () => {
        const out = normalizeUserDoc({
            roles: ['wave_participant'],
            serviceRegistrations: { wave: { status: 'pending' } },
        });
        expect(sr(out).wave.status).toBe('approved');
    });

    it.each(['active', 'approved', 'verified'])('leaves %s alone', (status) => {
        const out = normalizeUserDoc({
            roles: ['cooperative_member'],
            serviceRegistrations: { cooperatives: { status } },
        });
        expect(sr(out).cooperatives.status).toBe(status);
    });

    it('heals both cooperative spellings together', () => {
        const out = normalizeUserDoc({ roles: ['cooperative_member'] });
        expect(sr(out).cooperatives.status).toBe('approved');
        expect(sr(out).cooperative.status).toBe('approved');
    });

    it('touches nothing for an account with no module roles', () => {
        const out = normalizeUserDoc({ roles: ['user'], serviceRegistrations: {} });
        expect(sr(out)).toEqual({});
    });

    it('does not mutate the document it was given', () => {
        const input = { roles: ['wave_participant'], serviceRegistrations: { wave: { status: 'pending' } } };
        normalizeUserDoc(input);
        expect(input.serviceRegistrations.wave.status).toBe('pending');
    });

    it('the vocabulary itself: a decision is not just "not approved"', () => {
        expect(isDecidedAgainst('rejected')).toBe(true);
        expect(isDecidedAgainst('pending')).toBe(false);
        expect(isDecidedAgainst(undefined)).toBe(false);
        expect(isDecidedAgainst('')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the alias mirroring, executed', () => {
    it('mirrors cooperatives → cooperative and back', () => {
        expect(sr(normalizeUserDoc({ serviceRegistrations: { cooperatives: { status: 'active' } } })).cooperative)
            .toEqual({ status: 'active' });
        expect(sr(normalizeUserDoc({ serviceRegistrations: { cooperative: { status: 'active' } } })).cooperatives)
            .toEqual({ status: 'active' });
    });

    it('mirrors farmNation → farm_nation and back', () => {
        expect(sr(normalizeUserDoc({ serviceRegistrations: { farmNation: { status: 'verified' } } })).farm_nation)
            .toEqual({ status: 'verified' });
        expect(sr(normalizeUserDoc({ serviceRegistrations: { farm_nation: { status: 'verified' } } })).farmNation)
            .toEqual({ status: 'verified' });
    });

    it('when both exist, the further-along one wins and neither loses a field', () => {
        const out = normalizeUserDoc({
            serviceRegistrations: {
                cooperatives: { status: 'pending', memberId: 'm-1' },
                cooperative: { status: 'active', tier: 'Member' },
            },
        });

        expect(sr(out).cooperative).toMatchObject({ status: 'active', memberId: 'm-1', tier: 'Member' });
        expect(sr(out).cooperatives).toEqual(sr(out).cooperative);
    });

    it('mirrors phone and name', () => {
        expect(normalizeUserDoc({ phone: '0801' })).toMatchObject({ phone: '0801', phoneNumber: '0801' });
        expect(normalizeUserDoc({ phoneNumber: '0801' })).toMatchObject({ phone: '0801', phoneNumber: '0801' });
        expect(normalizeUserDoc({ name: 'Ada' })).toMatchObject({ name: 'Ada', fullName: 'Ada' });
        expect(normalizeUserDoc({ fullName: 'Ada' })).toMatchObject({ name: 'Ada', fullName: 'Ada' });
    });

    it('carries a FieldValue sentinel through recognisably', () => {
        // NOT identity. deepClone returns class instances as-is (a FieldValue
        // from firestore-compat is one) but copies plain objects, and the
        // jest.setup stand-ins are plain. That is fine: every sentinel detector
        // in this codebase reads `_methodName` or the constructor name, and
        // deepClone preserves the prototype — so a copy is still recognised.
        // Asserting `toBe` here would pin an implementation detail the writers
        // do not depend on.
        const sentinel = { _methodName: 'FieldValue.serverTimestamp' };
        const out = normalizeUserDoc({ updatedAt: sentinel });
        expect(out.updatedAt._methodName).toBe('FieldValue.serverTimestamp');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#208/#209 — the flat normaliser matches its nested twin', () => {
    it('WRITES fullName FROM displayName, as normalizeUserDoc does', () => {
        const flat = normalizeUserUpdate({ displayName: 'Ada Lovelace' });
        const nested = normalizeUserDoc({ displayName: 'Ada Lovelace' });

        // Was: flat set `name` only, so the same input produced two different
        // documents depending on which normaliser the caller reached for.
        expect(flat.name).toBe('Ada Lovelace');
        expect(flat.fullName).toBe('Ada Lovelace');
        expect(flat.fullName).toBe(nested.fullName);
    });

    it('MIRRORS A WHOLE-OBJECT WRITE, not only a sub-path', () => {
        const out = normalizeUserUpdate({
            'serviceRegistrations.cooperatives': { status: 'active' },
        });

        // Was: startsWith("...cooperatives.") with a trailing dot, so this key
        // matched nothing and the other spelling stayed stale.
        expect(out['serviceRegistrations.cooperative']).toEqual({ status: 'active' });
    });

    it('still mirrors a sub-path, in both directions and for both pairs', () => {
        expect(normalizeUserUpdate({ 'serviceRegistrations.cooperatives.status': 'active' }))
            .toHaveProperty(['serviceRegistrations.cooperative.status'], 'active');
        expect(normalizeUserUpdate({ 'serviceRegistrations.cooperative.status': 'active' }))
            .toHaveProperty(['serviceRegistrations.cooperatives.status'], 'active');
        expect(normalizeUserUpdate({ 'serviceRegistrations.farmNation.status': 'verified' }))
            .toHaveProperty(['serviceRegistrations.farm_nation.status'], 'verified');
        expect(normalizeUserUpdate({ 'serviceRegistrations.farm_nation.status': 'verified' }))
            .toHaveProperty(['serviceRegistrations.farmNation.status'], 'verified');
    });

    it('does not overwrite a mirror the caller set deliberately', () => {
        const out = normalizeUserUpdate({
            'serviceRegistrations.cooperatives.status': 'active',
            'serviceRegistrations.cooperative.status': 'pending',
        });
        expect(out['serviceRegistrations.cooperative.status']).toBe('pending');
    });

    it('does not mirror a key that merely shares a prefix', () => {
        const out = normalizeUserUpdate({ 'serviceRegistrations.cooperativesArchive': 1 });
        expect(Object.keys(out)).toEqual(['serviceRegistrations.cooperativesArchive']);
    });

    it('mirrors phone and name both ways', () => {
        expect(normalizeUserUpdate({ phone: '0801' })).toMatchObject({ phone: '0801', phoneNumber: '0801' });
        expect(normalizeUserUpdate({ phoneNumber: '0801' })).toMatchObject({ phone: '0801', phoneNumber: '0801' });
        expect(normalizeUserUpdate({ name: 'Ada' })).toMatchObject({ name: 'Ada', fullName: 'Ada' });
        expect(normalizeUserUpdate({ fullName: 'Ada' })).toMatchObject({ name: 'Ada', fullName: 'Ada' });
    });

    it('leaves an unrelated update untouched', () => {
        expect(normalizeUserUpdate({ isVerified: true })).toEqual({ isVerified: true });
    });
});
