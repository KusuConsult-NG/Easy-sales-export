/**
 * @jest-environment node
 */

/**
 *   #733 THIRTEEN OF THE FIFTEEN SMS AUDIENCES SENT WITHOUT ASKING WHETHER THE
 *        PERSON SHOULD BE CONTACTED AT ALL.
 *
 *   The in-app broadcast puts its check in ONE place — inside `add`, the funnel
 *   every audience goes through:
 *
 *       const add = (userId, name) => {
 *           if (userId && notContactable.has(userId)) return;
 *           …
 *       };
 *
 *   which is why it has no per-audience gaps. The SMS broadcast has the same
 *   funnel and never checked in it, so the rule reached whichever `case`
 *   somebody remembered: `all_except_approved_coop` (#697) and, since #732,
 *   `wave_briefing_registrants`. The other thirteen read a number off a row and
 *   sent to it.
 *
 * ── AND THE COST IS NOT THE ERASED MEMBER ───────────────────────────────────
 *
 *   #697 already settled that one: ERASED_FIELDS deletes the number from the
 *   user row and #376 scrubs it off the module rows, so "an erased member has no
 *   number left to reach".
 *
 *   contactableVerdict refuses TWO states, and the second is supersession —
 *   `_migratedTo` pointing at a different uid. #724's duplicate-profile tool
 *   creates exactly that state and DESTROYS NOTHING BY DESIGN: the superseded
 *   row keeps its name, email and phone so an admin's decision stays reversible.
 *
 *   So the person whose duplicate profile an admin resolved is still in the
 *   users collection twice, with the same number on both rows, and every SMS
 *   broadcast reached them twice. The platform's own de-duplication tool is what
 *   puts them in that state.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { contactableVerdict } from '@/lib/contactable-account';
import { normalisePhone } from '@/lib/phone';

const src = (rel: string) => stripComments(readFileSync(rel, 'utf-8'), { label: rel });
const SMS = 'src/app/actions/sms-broadcast.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#733 — a superseded row is not contactable, and keeps its number', () => {
    it('SUPERSESSION IS REFUSED, SEPARATELY FROM ERASURE', () => {
        const superseded = { _migratedTo: 'live-uid', phone: '08031234567' };
        const verdict = contactableVerdict(superseded, 'old-uid');

        expect(verdict.contactable).toBe(false);
        //   Named, because "erased" and "superseded" are different situations
        //   and only one of them removes the number.
        expect(verdict.reason).toBe('superseded');
    });

    it('AND THE ROW STILL CARRIES THE NUMBER — which is why this matters', () => {
        /*
         *   #724 writes only the supersession marker. If it scrubbed the row
         *   this finding would not exist, and it deliberately does not: the
         *   decision has to stay reversible.
         */
        const resolver = src('src/app/actions/admin/_duplicate_profiles.ts');

        expect(resolver).toContain('_migratedTo');
        //   Nothing on that path removes contact details.
        expect(resolver).not.toContain('FieldValue.delete()');
    });

    it('AND A ROW POINTING AT ITSELF IS NOT SUPERSEDED', () => {
        //   Vacuity guard: if every row with the field were refused, the
        //   migration winner would be silenced too.
        expect(contactableVerdict({ _migratedTo: 'same' }, 'same').contactable).toBe(true);
        expect(contactableVerdict({ phone: '08031234567' }, 'live').contactable).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#733 — the check lives in the funnel, not in the cases', () => {
    it('THE SMS `add` REFUSES A TOMBSTONED NUMBER', () => {
        const code = src(SMS);

        expect(code).toContain('nonContactablePhones.has(phone)');
        //   Inside `add`, which is the single place every audience reaches.
        const addAt = code.indexOf('const add = (rawPhone');
        const checkAt = code.indexOf('nonContactablePhones.has(phone)');
        expect(addAt).toBeGreaterThan(-1);
        expect(checkAt).toBeGreaterThan(addAt);
        expect(checkAt - addAt).toBeLessThan(400);
    });

    it('AND THE SET IS ACTUALLY LOADED', () => {
        //   A reference to a set nobody fills refuses nothing.
        expect(src(SMS)).toContain('loadNonContactablePhones(db, COLLECTIONS.USERS)');
    });

    it('AND IT IS NORMALISED ON BOTH SIDES — #729', () => {
        /*
         *   One number is stored under four spellings. A raw comparison here
         *   would miss the row it is meant to catch, which is this same defect
         *   one layer down.
         */
        const loader = src('src/lib/contactable-account.ts');
        expect(loader).toContain('normalisePhone(raw)');

        //   And the funnel normalises the incoming number before testing it.
        const code = src(SMS);
        const normAt = code.indexOf('const phone = normalisePhone(rawPhone)');
        const checkAt = code.indexOf('nonContactablePhones.has(phone)');
        expect(normAt).toBeGreaterThan(-1);
        expect(checkAt).toBeGreaterThan(normAt);

        //   Exercised, not just read: the four spellings collapse to one key.
        const forms = ['08031234567', '+2348031234567', '2348031234567'];
        expect(new Set(forms.map((f) => normalisePhone(f))).size).toBe(1);
    });

    it('AND THE LOADER READS EVERY FIELD A NUMBER IS STORED UNDER', () => {
        //   The user row keeps a number in three places; catching one of them
        //   is the shape of the finding this repairs.
        const loader = src('src/lib/contactable-account.ts');
        for (const field of ['data.phone', 'data.phoneNumber', 'data.kyc?.phoneNumber']) {
            expect(loader).toContain(field);
        }
    });

    it('AND IT COVERS BOTH TOMBSTONE STATES, NOT JUST ERASURE', () => {
        //   `deleted` alone would leave exactly the case this finding is about.
        const loader = src('src/lib/contactable-account.ts');
        const at = loader.indexOf('export async function loadNonContactablePhones');
        const body = loader.slice(at);

        expect(body).toContain('"deleted", "==", true');
        expect(body).toContain('"_migratedTo", "!="');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#733 — and it fails open, because the alternative is worse', () => {
    it('A READ ERROR LEAVES THE AUDIENCE INTACT RATHER THAN EMPTY', async () => {
        /*
         *   loadNonContactableUserIds states the rule and this follows it:
         *   "losing a broadcast to everybody is worse than including a handful
         *   of tombstones". Exercised against a collection that throws.
         */
        const { loadNonContactablePhones } = await import('@/lib/contactable-account');

        const exploding = {
            collection: () => ({
                where: () => ({ select: () => ({ all: () => ({ get: () => Promise.reject(new Error('down')) }) }) }),
            }),
        };

        await expect(loadNonContactablePhones(exploding as any, 'users')).resolves.toEqual(new Set());
    });

    it('AND A ROW WITH NO NUMBER ADDS NOTHING TO THE SET', async () => {
        const { loadNonContactablePhones } = await import('@/lib/contactable-account');

        const rows = [
            { data: () => ({ phone: '08031234567' }) },
            { data: () => ({}) },
            { data: () => ({ phoneNumber: null }) },
            { data: () => ({ kyc: { phoneNumber: '+2348039999999' } }) },
        ];
        let call = 0;
        const db = {
            collection: () => ({
                where: () => ({
                    select: () => ({
                        all: () => ({ get: () => Promise.resolve({ docs: call++ === 0 ? rows : [] }) }),
                    }),
                }),
            }),
        };

        const set = await loadNonContactablePhones(db as any, 'users');
        expect(set.has(normalisePhone('08031234567')!)).toBe(true);
        expect(set.has(normalisePhone('08039999999')!)).toBe(true);
        expect(set.size).toBe(2);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy,
 *   each mutant proving its edit landed by a unique string on disk. RUN, not
 *   predicted — #732 recorded the cost of writing this table the other way
 *   round.
 *
 *     MUTANT                                                        RESULT
 *     the funnel stops refusing a tombstoned number                  KILLED
 *     the set is loaded but never consulted                          KILLED
 *     the loader drops the supersession query                        KILLED
 *     the loader drops the erasure query                             KILLED
 *     the loader stops normalising, so spellings miss                KILLED
 *     the loader reads `phone` only, not phoneNumber or kyc          KILLED
 *     the loader throws instead of failing open                      KILLED
 *     supersession stops being refused by contactableVerdict         KILLED
 *     a row pointing at itself is treated as superseded              KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
