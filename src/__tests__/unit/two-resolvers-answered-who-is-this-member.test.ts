/**
 * @jest-environment node
 */

/**
 *   #754 TWO RESOLVERS ANSWER "WHO IS THIS MEMBER", AND THE THIN ONE SERVES
 *        FIVE OF THE SIX SCREENS.
 *
 *   Reported by the owner: "when admin views members most times they see empty
 *   fields and missing informations".
 *
 *   MEASURED BEFORE ANYTHING WAS CHANGED. Given a user document whose details
 *   live in a module registration — the ordinary shape for anyone who joined
 *   through the cooperative, WAVE or marketplace flow — `extractCanonicalUser`
 *   returned:
 *
 *       name: ""   phone: ""   state: ""   nin: ""   bankName: ""
 *
 *   Every field. It read `uData.verificationProfile` and the top-level keys and
 *   nothing else, while the member's firstName, phone, state, NIN and bank
 *   details sat under `serviceRegistrations.<module>.profile`.
 *
 *   `_users.ts` — which powers /admin/users — walks every module registration
 *   for exactly those fields, and has done for a long time. So THE SAME MEMBER
 *   renders fully on /admin/users and blank on:
 *
 *       cooperative/_coop_admin_members    the cooperative members list
 *       cooperative/_coop_admin_money      the contributions screen
 *       admin/_withdrawals                 the admin withdrawal queue
 *       wave/_wv_admin_withdrawals         the WAVE withdrawal queue
 *       wave/_wv_certificates              the certificate
 *
 *   Two implementations of one question, and the one that was kept current
 *   serves a single screen. That is why the report says "most times".
 *
 * ── FOUR DIFFERENCES, ALL MEASURED ──────────────────────────────────────────
 *
 *     1  serviceRegistrations was never read          → every field blank
 *     2  no placeholder rejection                     → the name "User"
 *     3  state/lga returned whatever shape was stored → an OBJECT to React
 *     4  kyc.nin / kyc.bvn were not in the chains     → blank NIN and BVN
 *
 *   (2) is the sharper half of the "empty fields" report, because it is not
 *   empty: the ghost-account auto-repair wrote "User" and "Unknown" into
 *   fullName before April 2026, and five screens printed those as people's
 *   names. /admin/users has rejected them all along, with the reason beside it:
 *   "Fall through to the email address so the admin table shows something
 *   meaningful."
 *
 *   (3) is worse than a missing field and was found on the way. Some
 *   generations store `state` as `{ name, code }`. `_users.ts` unwraps it and
 *   says why — "preventing React objects-as-children crashes" — and this
 *   resolver handed the object straight to whatever rendered it.
 *
 * ── STRICTLY ADDITIVE ───────────────────────────────────────────────────────
 *
 *   Every new source goes on the END of its chain, so a member who resolved
 *   before resolves identically. The one deliberate change in PRIORITY is the
 *   placeholder rule: "Unknown" no longer beats a real name further down, which
 *   is the whole point of having the rule.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractCanonicalUser } from '@/lib/canonical/normalizer';
import { isPlaceholderName, asDisplayString } from '@/lib/canonical/placeholder-names';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

/** A member who joined through the cooperative flow. Nothing at the top level. */
const MODULE_MEMBER = {
    email: 'amaka@example.com',
    serviceRegistrations: {
        cooperative: {
            status: 'active',
            profile: {
                firstName: 'Amaka',
                lastName: 'Obi',
                phone: '08012345678',
                state: 'Lagos',
                lga: 'Ikeja',
                dateOfBirth: '1990-04-02',
                gender: 'female',
                nin: '12345678901',
                bankDetails: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Amaka Obi' },
            },
        },
    },
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#754 — the member whose details live in a module registration', () => {
    it('RESOLVES AT ALL, WHERE EVERY FIELD USED TO COME BACK EMPTY', () => {
        /*
         *   THE reported defect, as one assertion. Before this change every one
         *   of these was "".
         */
        const u = extractCanonicalUser(MODULE_MEMBER);

        expect({
            name: u.name, phone: u.phone, state: u.address.state,
            nin: u.nin, bank: u.bankDetails.bankName,
        }).toEqual({
            name: 'Amaka Obi', phone: '08012345678', state: 'Lagos',
            nin: '12345678901', bank: 'GTBank',
        });
    });

    it('AND THE REST OF THE RECORD COMES WITH IT', () => {
        //   Not just the headline fields: an admin opening a member looks at
        //   the date of birth, the LGA and the destination account too.
        const u = extractCanonicalUser(MODULE_MEMBER);

        expect({
            dob: u.dateOfBirth, gender: u.gender, lga: u.address.lga,
            account: u.bankDetails.accountNumber,
        }).toEqual({
            dob: '1990-04-02', gender: 'female', lga: 'Ikeja',
            account: '0123456789',
        });
    });

    it('and a registration stored WITHOUT a nested profile is read too', () => {
        /*
         *   `_users.ts` uses `reg?.profile || reg`, because some schema
         *   generations nest the profile under the registration and some put
         *   the fields directly on it. Matching that exactly — a resolver that
         *   handled one shape would leave half the population blank and look
         *   fixed.
         */
        const u = extractCanonicalUser({
            email: 'x@e.com',
            serviceRegistrations: { wave: { fullName: 'Grace Bello', phone: '0803' } },
        });

        expect({ name: u.name, phone: u.phone }).toEqual({ name: 'Grace Bello', phone: '0803' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#754 — and a placeholder is not a name', () => {
    it('"User" DOES NOT COME BACK AS SOMEBODY\'S NAME', () => {
        //   Measured at "User" before the change. Written by the ghost-account
        //   auto-repair before April 2026 and printed as a person on five
        //   screens.
        expect(extractCanonicalUser({ fullName: 'User', email: 'a@b.com' }).name).toBe('');
    });

    it('AND NOR DOES "Unknown", "Unknown User" OR "N/A"', () => {
        for (const v of ['Unknown', 'unknown user', 'N/A', 'n/a', '  USER  ']) {
            expect({ v, name: extractCanonicalUser({ fullName: v, email: 'a@b.com' }).name })
                .toEqual({ v, name: '' });
        }
    });

    it('AND A PLACEHOLDER NO LONGER BEATS A REAL NAME FURTHER DOWN THE CHAIN', () => {
        /*
         *   The point of the rule, and the one deliberate change in priority.
         *   "Unknown" is truthy, so it used to win simply by being first — and
         *   the member's real name sat one field away on the row the admin
         *   screen had already loaded.
         */
        const u = extractCanonicalUser(
            { fullName: 'Unknown', email: 'a@b.com' },
            { firstName: 'Amaka', lastName: 'Obi' },
        );

        expect(u.name).toBe('Amaka Obi');
    });

    it('and a real name is untouched — the vacuity guard', () => {
        //   A rule that rejected everything would satisfy all three above.
        expect(extractCanonicalUser({ fullName: 'Grace Bello' }).name).toBe('Grace Bello');
        expect(isPlaceholderName('Grace Bello')).toBe(false);
        expect(isPlaceholderName('User')).toBe(true);
    });

    it('and the rule lives in ONE place, which is why this is a fix and not a third copy', () => {
        /*
         *   `_users.ts` had its own PLACEHOLDER_NAMES set. Two sets of magic
         *   strings maintained by hand is the same defect waiting to recur —
         *   the next spelling somebody adds goes into one of them.
         */
        const shared = 'src/lib/canonical/placeholder-names.ts';

        expect(code('src/lib/canonical/normalizer.ts')).toContain('from "./placeholder-names"');
        expect(code(shared)).toContain('export const PLACEHOLDER_NAMES');
    });

    it('AND NO PRIVATE COPY SURVIVES ANYWHERE — the assertion above did not check', () => {
        /*
         *   THIS RATCHET DID NOT RATCHET, and the comment above says why in the
         *   past tense: "`_users.ts` HAD its own set". It still did. Asserting
         *   that the shared file exists and that ONE caller imports it says
         *   nothing about the callers that never converted.
         *
         *   SIX private copies were live when this was written — _users.ts,
         *   analytics.service.ts, _marketplace.ts and three admin EXPORT routes,
         *   all with the identical five-element set and none of them knowing
         *   "unknown member". The export routes are the worst of the six: that
         *   string was being written into the CSVs the owner downloads as a
         *   member's name.
         *
         *   Found only because a production query surfaced 41 members about to
         *   be named "Unknown Member" by a repair — and then only because a
         *   `grep | head -20` had hidden four of the six from the first sweep.
         */
        const { execSync } = require('child_process');
        const copies = execSync(
            `grep -rnE 'PLACEHOLDER_NAMES[^=]*= new Set' src/ --include=*.ts --include=*.tsx | grep -v '/__tests__/' || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        ).trim().split('\n').filter(Boolean)
            //   The one definition is allowed. Everything else is a copy.
            .filter((l: string) => !l.startsWith('src/lib/canonical/placeholder-names.ts:'));

        expect({ copies }).toEqual({ copies: [] });
    });

    it('VACUITY GUARD: the search finds the real definition', () => {
        //   A grep that matched nothing would pass the test above against a
        //   codebase with six copies in it — which is exactly what happened.
        //
        //   AND IT EARNED ITS KEEP IMMEDIATELY: the first version of the
        //   pattern was `PLACEHOLDER_NAMES = new Set`, which does not match
        //   the real definition because that one carries a type annotation
        //   (`: ReadonlySet<string> =`). The census above would have passed
        //   while finding nothing at all.
        const { execSync } = require('child_process');
        const found = execSync(
            `grep -rnE 'PLACEHOLDER_NAMES[^=]*= new Set' src/ --include=*.ts | grep -v '/__tests__/' || true`,
            { encoding: 'utf8', cwd: process.cwd() },
        ).trim();

        expect(found).toContain('src/lib/canonical/placeholder-names.ts');
    });

    it('AND THE SPELLING THE PLATFORM ACTUALLY WROTE IS REFUSED — #495', () => {
        /*
         *   2,591 profiles carry `fullName: "Unknown Member"` with
         *   firstName "Unknown", lastName "Member", no email, no phone, and
         *   verified/isVerified/profileComplete all true — written on
         *   29 May 2026 by a backfill that is in no commit on any branch.
         *
         *   Every placeholder set on the platform, shared and private alike,
         *   was missing it. So the one string that most needed rejecting was
         *   the one spelling nothing recognised, and _users.ts stopped looking
         *   for a better name the moment it found one.
         */
        expect(isPlaceholderName('Unknown Member')).toBe(true);
        expect(isPlaceholderName('unknown member')).toBe(true);
        expect(isPlaceholderName('  UNKNOWN MEMBER  ')).toBe(true);
        //   Both halves of the pair those rows carry.
        expect(isPlaceholderName('Unknown')).toBe(true);
        expect(isPlaceholderName('Member')).toBe(true);

        //   And it did not become a rule that rejects people. The names here
        //   are the real ones recovered from the cooperative register.
        for (const real of ['Ngozi Eledumare', 'Bulus Zipporah', 'Hafsatu Dange Umar',
                            'Abubakar Junaidu Umar', 'Nimota Afolasade Odumala']) {
            expect({ real, placeholder: isPlaceholderName(real) })
                .toEqual({ real, placeholder: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#754 — and a field that must render as text does', () => {
    it('AN OBJECT-SHAPED state COMES BACK AS A STRING', () => {
        /*
         *   Worse than a missing field: React throws on an object as a child,
         *   so a screen rendering {address.state} from this resolver was one
         *   legacy row away from a blank page. `_users.ts` guards it and says
         *   so; this one returned the object.
         */
        const u = extractCanonicalUser({ email: 'a@b.com', state: { name: 'Lagos', code: 'LA' } });

        expect(u.address.state).toBe('Lagos');
        expect(typeof u.address.state).toBe('string');
    });

    it('AND SO DOES AN OBJECT-SHAPED lga', () => {
        const u = extractCanonicalUser({ email: 'a@b.com', lga: { lga: 'Ikeja' } });

        expect(u.address.lga).toBe('Ikeja');
    });

    it('and every address field is a string whatever was stored', () => {
        //   Counted rather than sampled: one unguarded field is one crash.
        const u = extractCanonicalUser({
            email: 'a@b.com',
            address: { street: { value: '12 Broad St' }, state: { name: 'Lagos' }, lga: { name: 'Ikeja' } },
        });

        for (const [k, v] of Object.entries(u.address)) {
            expect({ k, type: typeof v }).toEqual({ k, type: 'string' });
        }
    });

    it('and a shape with nothing usable in it becomes "", not "[object Object]"', () => {
        expect(asDisplayString({ unexpected: 1 })).toBe('');
        expect(asDisplayString(null)).toBe('');
        expect(asDisplayString('Lagos')).toBe('Lagos');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#754 — and the KYC block is read where the KYC flow writes it', () => {
    it('kyc.nin AND kyc.bvn RESOLVE', () => {
        //   Measured as "" for both before the change. `_users.ts` reads
        //   `data.kyc?.nin || data.nin` and always has.
        const u = extractCanonicalUser({ email: 'a@b.com', kyc: { nin: '12345678901', bvn: '22222222222' } });

        expect({ nin: u.nin, bvn: u.bvn }).toEqual({ nin: '12345678901', bvn: '22222222222' });
    });

    it('and the top-level spelling still wins, so nothing moves for anyone who had one', () => {
        const u = extractCanonicalUser({
            email: 'a@b.com',
            verificationProfile: { nin: 'CANONICAL' },
            kyc: { nin: 'KYC' },
            nin: 'TOP',
        });

        expect(u.nin).toBe('CANONICAL');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#754 — and the change is additive for everybody who already resolved', () => {
    /**
     * The claim that makes this safe to deploy against 42,600 live accounts.
     * Each case below resolved before the change and must resolve identically
     * after it — the new sources are appended, never prepended.
     */
    const CASES: Array<[string, any, any, Record<string, string>]> = [
        ['a plain modern user',
            { fullName: 'Grace Bello', email: 'g@e.com', phone: '0802' }, null,
            { name: 'Grace Bello', phone: '0802' }],
        ['first + last on the user document',
            { firstName: 'Ada', lastName: 'Obi', email: 'a@e.com' }, null,
            { name: 'Ada Obi' }],
        ['a name on the application row only',
            {}, { fullName: 'Chinwe Eze' },
            { name: 'Chinwe Eze' }],
        ['the user document beating the application row',
            { fullName: 'Real Name' }, { fullName: 'Stale Name' },
            { name: 'Real Name' }],
        ['#751 — first + last on the application row, no fullName',
            {}, { firstName: 'Fatima', lastName: "Sama'ila" },
            { name: "Fatima Sama'ila" }],
        ['a middle name, kept in order',
            {}, { firstName: 'Amaka', otherName: 'Ngozi', lastName: 'Obi' },
            { name: 'Amaka Ngozi Obi' }],
    ];

    it.each(CASES)('%s', (_label, uData, appData, expected) => {
        const u = extractCanonicalUser(uData, appData) as Record<string, any>;

        for (const [k, v] of Object.entries(expected)) {
            expect({ k, got: u[k] }).toEqual({ k, got: v });
        }
    });

    it('AND THE USER DOCUMENT STILL BEATS THE MODULE REGISTRATION', () => {
        //   The ordering claim, asserted directly. If the module harvest had
        //   been prepended, a stale module profile would override the row the
        //   member actually maintains.
        const u = extractCanonicalUser({
            fullName: 'Top Level',
            email: 'a@b.com',
            serviceRegistrations: { wave: { profile: { fullName: 'Module Copy' } } },
        });

        expect(u.name).toBe('Top Level');
    });

    it('and an empty document is still empty rather than throwing', () => {
        //   Four of the six call sites pass ONE argument, so appData is null
        //   there and an orphan row arrives as {}. It must not throw.
        expect(() => extractCanonicalUser({})).not.toThrow();
        expect(extractCanonicalUser({}).name).toBe('');
        expect(() => extractCanonicalUser(undefined as any)).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#754 — and the screens that were blank all use this resolver', () => {
    const CALLERS = [
        'src/app/actions/cooperative/_coop_admin_members.ts',
        'src/app/actions/cooperative/_coop_admin_money.ts',
        'src/app/actions/admin/_withdrawals.ts',
        'src/app/actions/wave/_wv_admin_withdrawals.ts',
        'src/app/actions/wave/_wv_certificates.ts',
    ];

    it('ALL FIVE STILL CALL IT, SO THE FIX REACHES THEM', () => {
        //   Vacuity guard with a point: this finding is only worth anything if
        //   the screens in the report are the ones on this resolver.
        for (const f of CALLERS) {
            expect({ f, uses: code(f).includes('extractCanonicalUser(') })
                .toEqual({ f, uses: true });
        }
    });

    it('AND FOUR OF THEM PASS NO FALLBACK ROW, WHICH IS WHY THE HARVEST MATTERS', () => {
        /*
         *   Recorded because it bounds what this fix can do. Only
         *   _coop_admin_members passes a second argument; the other four call
         *   `extractCanonicalUser(uData)`, so for a member with no profile
         *   document there is no appData to fall back to and the module
         *   registrations are the ONLY remaining source. That is precisely the
         *   source this resolver was not reading.
         */
        //   A SINGLE argument is the absence of a comma, not a particular
        //   spelling of an identifier. A first draft matched `[A-Za-z?. ]+` and
        //   missed `extractCanonicalUser(userData ?? {})` in _wv_certificates,
        //   reporting three where there are four — the instrument describing
        //   the code it expected rather than the code that is there.
        const single = CALLERS.filter((f) =>
            /extractCanonicalUser\([^,()]*(?:\{\})?[^,()]*\)/.test(code(f)));

        expect(single).toHaveLength(4);
        expect(single).not.toContain('src/app/actions/cooperative/_coop_admin_members.ts');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *     MUTANT                                                        RESULT
 *     the module harvest returns nothing                             KILLED
 *     the harvest stops handling an un-nested registration           KILLED
 *     the placeholder rule is removed from the name chain            KILLED
 *     the placeholder set loses "user"                               KILLED
 *     asDisplayString returns the object unchanged                   KILLED
 *     the kyc spelling is dropped from nin                           KILLED
 *     the module harvest is PREPENDED instead of appended            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   The prepend mutant is the one worth naming: it makes every "does it
 *   resolve" test PASS — the member's name comes back either way — and is
 *   caught only by the additive suite, which asserts that a stale module copy
 *   does NOT override the row the member maintains. A fix to a fallback chain
 *   can be wrong in the ordering while being right in the outcome, and only a
 *   test written about priority can see it.
 *
 *   ONE ASSERTION IN THIS FILE WAS WRONG BEFORE IT WAS RIGHT: the single-argument
 *   sweep matched `[A-Za-z?. ]+` and missed `extractCanonicalUser(userData ?? {})`,
 *   reporting three call sites where there are four — the instrument describing
 *   the code I expected rather than the code that is there.
 */
