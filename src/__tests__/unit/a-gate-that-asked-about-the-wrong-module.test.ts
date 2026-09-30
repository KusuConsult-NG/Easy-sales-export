/**
 * @jest-environment node
 */

/**
 *   #973 A PURCHASE GATE THAT ASKED ABOUT THE WRONG MODULE.
 *
 *   THE OWNER, reporting it from users: "users just reported that when trying to
 *   make purchase on farm nation, there is a gate that tells them they are not
 *   part of cooperative which is not supposed to be so, fix that and check for
 *   where you have these kind of gate that are stopping users from using another
 *   module because they are not subscribed to the other."
 *
 *   Farm Nation sells land. The cooperative is a savings-and-loans service. FOUR
 *   doors on the Farm Nation path refused a buyer who was not in the
 *   cooperative:
 *
 *     actions/farm-nation-payment.ts          the action that charges the card
 *     actions/farm-nation/_fn_purchases.ts    initiatePropertyPurchaseAction
 *     actions/farm-nation/_fn_listings.ts     listPropertyAction (legacy path)
 *     farm-nation/checkout/[…]/CheckoutClient a full-screen refusal
 *
 *   AND NONE OF THEM WAS EVER A DECISION. `git log -S` traces all four to
 *   9adac845, "feat: Phase 5 Security Audit — Fix critical vulnerabilities",
 *   February 2026, whose other changes are real fixes. Bundled in was a check
 *   that the buyer's cooperative tier was `"Premium"` — and `"Basic"`/`"Premium"`
 *   were retired when the cooperative went to one flat ₦10,000 fee. The gates
 *   were mechanically re-pointed at the surviving tier. `_fn_listings.ts` still
 *   carried the original comment, `// Check user tier (Premium required)`, above
 *   a test of `serviceRegistrations.cooperatives.status`: a rule whose own
 *   comment names a concept the platform deleted.
 *
 *   #815 WAS MINE AND IT MADE IT WORSE. Finding the rule in the screen and
 *   nowhere else, I enforced it in the action that takes the money — right about
 *   client-side gates being decoration, and never asking whether the rule was
 *   correct. Hardening a wrong rule turns a bug users could sometimes get past
 *   into one they cannot.
 *
 * ── WHAT REPLACES IT ────────────────────────────────────────────────────────
 *
 *   Nothing. A signed-in buyer may buy land, which is what the application's own
 *   routing already said: checkout, /properties, /property/[id] and /map all sit
 *   OUTSIDE the (member) route group, and that group gates on
 *   `checkModuleAccess(..., "farm-nation")` — never the cooperative's.
 *
 *   AND NOT THAT GATE HERE EITHER, which was the tempting substitution: it
 *   requires an application an ADMIN has approved, while Farm Nation onboarding
 *   writes `pending`. It would replace a wrong gate with a slower one.
 *
 * ── THE RATCHET IS THE POINT ────────────────────────────────────────────────
 *
 *   The owner asked for the CLASS, not the instance. The last block below walks
 *   every module's own files and fails when one of them reads another module's
 *   role or registration, against a recorded list of the cases that are
 *   deliberate. A new pair cannot appear without somebody writing down why.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     put the cooperative read back in farm-nation-payment          KILLED
 *     put the coopStatus gate back in _fn_purchases                 KILLED
 *     put the coopStatus gate back in _fn_listings                  KILLED
 *     drop one entry from the deliberate-pairs list                 KILLED
 *     add a cooperative read to a farm-nation file                  KILLED
 *     the scanner reading raw source instead of stripped            KILLED
 *     reword this header                                 SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const code = (rel: string) => stripComments(read(rel), { label: rel });

/** The four doors, and the reads none of them may carry. */
const FARM_NATION_DOORS = [
    'src/app/actions/farm-nation-payment.ts',
    'src/app/actions/farm-nation/_fn_purchases.ts',
    'src/app/actions/farm-nation/_fn_listings.ts',
    'src/app/farm-nation/checkout/[propertyId]/CheckoutClient.tsx',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#973 — no Farm Nation door asks about the cooperative', () => {
    it.each(FARM_NATION_DOORS)('%s carries no cooperative membership read', (file) => {
        const src = code(file);

        //   Every spelling the four of them used between them, so a gate put
        //   back through any one of them fails here.
        expect(src).not.toMatch(/cooperativeTierForPerson/);
        expect(src).not.toMatch(/getUserTierAction/);
        expect(src).not.toMatch(/COOPERATIVE_MEMBERS/);
        expect(src).not.toMatch(/serviceRegistrations\s*[?.]*\s*\.?\s*\[?\s*["']?cooperatives?\b/);
    });

    it('AND NONE OF THEM TELLS A BUYER TO JOIN THE COOPERATIVE', () => {
        //   The user-visible half. A gate can be reinstated with a different
        //   helper; it cannot be reinstated without saying something.
        for (const file of FARM_NATION_DOORS) {
            const src = code(file);
            expect({ file, mentions: /join the cooperative/i.test(src) })
                .toEqual({ file, mentions: false });
            expect({ file, mentions: /sold to cooperative members/i.test(src) })
                .toEqual({ file, mentions: false });
        }
    });

    it('POSITIVE CONTROL: the files really are being read', () => {
        //   Four `not.toMatch`es pass beautifully against an empty string, and
        //   this suite would then be decoration. Each door must still contain
        //   the thing it is for.
        expect(code(FARM_NATION_DOORS[0])).toMatch(/initializePropertyPaymentAction|paystack|authorizationUrl/i);
        expect(code(FARM_NATION_DOORS[1])).toMatch(/PropertyPurchase/i);
        expect(code(FARM_NATION_DOORS[2])).toMatch(/listProperty|farmNationListingSchema/i);
        expect(code(FARM_NATION_DOORS[3])).toMatch(/Complete your purchase request|buyerInfo/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * The six modules, the role names each owns, and the `serviceRegistrations` key
 * each is recorded under. Both lists are lib/module-access-check's, restated
 * here so this scanner keeps working if that file is refactored — and the last
 * test in this file asserts the two agree.
 */
const MODULES = ['farm-nation', 'cooperatives', 'academy', 'marketplace', 'wave', 'export'] as const;
type Module = typeof MODULES[number];

const OWNED_ROLES: Record<Module, string[]> = {
    cooperatives: ['cooperative_member'],
    academy: ['academy_participant'],
    wave: ['wave_participant'],
    export: ['export_participant'],
    'farm-nation': ['farmer', 'land_owner', 'investor'],
    marketplace: ['marketplace_buyer', 'marketplace_seller'],
};
/**
 * The named readers that answer "is this person in module X".
 *
 *   ADDED AFTER A MUTANT GOT PAST. Putting the cooperative gate back into
 *   farm-nation-payment.ts failed the four door tests above and NOT the ratchet,
 *   because `cooperativeTierForPerson` is a function name and the scanner was
 *   only looking for role strings and registration keys. The door tests cover the
 *   four doors; the ratchet has to cover the other few hundred files, so it needs
 *   to know the helpers too.
 */
const OWNED_READERS: Record<Module, string[]> = {
    cooperatives: [
        'cooperativeTierForPerson', 'getUserTierAction', 'findCooperativeMemberRow',
        'findCooperativeMemberRowForPerson', 'memberStatusOf', 'COOPERATIVE_MEMBERS',
    ],
    academy: ['isAcademyPaid'],
    wave: [],
    export: [],
    'farm-nation': [],
    marketplace: ['checkMarketplaceStatusAction'],
};

const REGISTRATION_KEY: Record<Module, string> = {
    wave: 'wave', academy: 'academy', export: 'export',
    cooperatives: 'cooperatives', 'farm-nation': 'farmNation', marketplace: 'marketplace',
};

/**
 * Which module a file belongs to, or null for shared code.
 *
 * Shared code (lib/module-access-check, the session guard, the role vocabulary)
 * is ABOUT every module by design, so it is out of scope. So is anything under
 * an admin path: an administrator's screen legitimately reads all six.
 */
function moduleOf(rel: string): Module | null {
    const p = rel.replace(/\\/g, '/');
    if (p.includes('/admin') || p.includes('__tests__')) return null;
    if (/farm-nation|farmNation|farm_nation/.test(p)) return 'farm-nation';
    for (const m of MODULES) {
        if (m === 'farm-nation') continue;
        if (p.includes(`/${m}/`) || p.includes(`${m}-`) || p.includes(`_${m}`) || p.includes(`/${m}.`)) return m;
    }
    return null;
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== '__tests__' && entry !== 'node_modules') walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(relative(process.cwd(), full));
        }
    }
    return out;
}

/**
 * The cases where one module's file reads another's membership ON PURPOSE.
 *
 *   Every one is a GRANT — it widens who may do something — and not one of them
 *   can refuse anybody. That is the distinction the owner's report is about: a
 *   perk that lets an Academy Elite member into WAVE costs nobody anything; a
 *   gate that stops a land buyer for not saving with the cooperative stops a
 *   sale.
 *
 *   Verified one at a time when this ratchet was written:
 *
 *     wave-eligibility.ts        `isAcademyElite` → eligible REGARDLESS. The
 *                                comment above it says "Admins and Academy Elite
 *                                members are eligible regardless", and the
 *                                branch returns true.
 *     wave-resource-access.ts    same shape, `return academyReg?.plan === 'elite'
 *                                && …` as the last of several ways to qualify.
 *     wave/_wv_applications.ts   reads `isAcademyElite` into the shared
 *                                eligibility rule; refuses nobody for it.
 *     wave/briefing/page.tsx     the string 'investor' in prose on a briefing
 *                                page. Not a role test — no session is read.
 */
const DELIBERATE: ReadonlySet<string> = new Set([
    'src/lib/wave-eligibility.ts -> academy registration',
    'src/lib/wave-resource-access.ts -> academy registration',
    'src/app/actions/wave/_wv_applications.ts -> academy registration',
    "src/app/wave/briefing/page.tsx -> farm-nation role 'investor'",
]);

describe('#973 — the ratchet: no module gates on another module', () => {
    it('EVERY CROSS-MODULE MEMBERSHIP READ IS ONE SOMEBODY WROTE DOWN', () => {
        const found: string[] = [];

        for (const rel of walk(join(process.cwd(), 'src'))) {
            const mine = moduleOf(rel);
            if (!mine) continue;
            //   STRIPPED, not raw. Half this repository's headers discuss other
            //   modules by name; prose is not a gate, and a scanner that counted
            //   it would be unusable and would then be switched off.
            const src = stripComments(read(rel), { label: rel });

            for (const other of MODULES) {
                if (other === mine) continue;
                for (const role of OWNED_ROLES[other]) {
                    if (new RegExp(`["']${role}["']`).test(src)) {
                        found.push(`${rel} -> ${other} role '${role}'`);
                    }
                }
                const key = REGISTRATION_KEY[other];
                if (new RegExp(`serviceRegistrations[?.\\[\\'"\\s]*${key}\\b`).test(src)) {
                    found.push(`${rel} -> ${other} registration`);
                }
                for (const reader of OWNED_READERS[other]) {
                    if (new RegExp(`\\b${reader}\\b`).test(src)) {
                        found.push(`${rel} -> ${other} reader ${reader}`);
                    }
                }
            }
        }

        const unexplained = found.filter((f) => !DELIBERATE.has(f)).sort();
        expect({ unexplained }).toEqual({ unexplained: [] });
    });

    it('AND EVERY WRITTEN-DOWN CASE STILL EXISTS — the list cannot rot', () => {
        /*
         *   The other direction, and the one that matters more over time. An
         *   allowlist nobody prunes becomes a licence: a stale entry would let a
         *   future gate through under the name of a read that had been deleted.
         */
        const stillThere: string[] = [];
        for (const rel of walk(join(process.cwd(), 'src'))) {
            const mine = moduleOf(rel);
            if (!mine) continue;
            const src = stripComments(read(rel), { label: rel });
            for (const other of MODULES) {
                if (other === mine) continue;
                for (const role of OWNED_ROLES[other]) {
                    if (new RegExp(`["']${role}["']`).test(src)) stillThere.push(`${rel} -> ${other} role '${role}'`);
                }
                const key = REGISTRATION_KEY[other];
                if (new RegExp(`serviceRegistrations[?.\\[\\'"\\s]*${key}\\b`).test(src)) {
                    stillThere.push(`${rel} -> ${other} registration`);
                }
                for (const reader of OWNED_READERS[other]) {
                    if (new RegExp(`\\b${reader}\\b`).test(src)) {
                        stillThere.push(`${rel} -> ${other} reader ${reader}`);
                    }
                }
            }
        }
        const gone = [...DELIBERATE].filter((d) => !stillThere.includes(d)).sort();
        expect({ gone }).toEqual({ gone: [] });
    });

    it('AND THE ROLE AND REGISTRATION TABLES AGREE WITH module-access-check', () => {
        //   This scanner restates two tables. A restatement is acceptable only
        //   while something fails when the copies drift — this is that.
        const gate = code('src/lib/module-access-check.ts');

        for (const m of MODULES) {
            expect({ module: m, present: gate.includes(`"${REGISTRATION_KEY[m]}"`) })
                .toEqual({ module: m, present: true });
            for (const role of OWNED_ROLES[m]) {
                expect({ role, present: gate.includes(`"${role}"`) })
                    .toEqual({ role, present: true });
            }
        }
    });
});
