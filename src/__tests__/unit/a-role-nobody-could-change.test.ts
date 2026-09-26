/**
 * @jest-environment node
 */

/**
 *   #947 A MEMBER PICKED BUYER OR SELLER ONCE AND COULD NEVER CHANGE IT.
 *
 *   The choice is not cosmetic. farm-nation-roles carries the owner's
 *   requirement: "when users sign up as sellers they can't have buyers features
 *   on their dashboards ... and this also applies to Farm Nation." So the
 *   Farm Nation dashboard branches on it throughout — a buyer sees no listing
 *   tools, a seller sees no purchase tools.
 *
 *   ── THE LEDGER UNDERSTATED IT ─────────────────────────────────────────────
 *
 *   The audit recorded the only edit path as
 *   `resubmitFarmNationApplicationAction`, "which writes status: pending" —
 *   implying an approved member could use it and be un-approved for their
 *   trouble. MEASURED, it is stricter: it admits only
 *
 *       ['pending', 'rejected', 'revision_required']
 *
 *   so an APPROVED member is refused outright. Not un-approved — turned away. A
 *   member who joined to buy land and now wants to sell some had no path of any
 *   kind, self-service or administrative.
 *
 *   ── WHY SELF-SERVICE IS SAFE, WHICH IS THE PART WORTH CHECKING ────────────
 *
 *   Gaining the seller role publishes nothing. _fn_listings writes every new
 *   listing at `status: "pending_verification"`, and the admin surface behind it
 *   is not a rubber stamp: approve-land, reject-land, land-verifications,
 *   dispatch-inspector and record-inspection, including a physical inspection.
 *   The role buys the right to SUBMIT for inspection, so it bypasses no
 *   verification — which is what would otherwise make this a privilege
 *   escalation dressed as a convenience.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { farmNationRoleChange, FARM_NATION_ROLES } from '@/lib/farm-nation-role-change';
import { FARM_NATION_BUYER_ROLE, FARM_NATION_SELLER_ROLE } from '@/lib/farm-nation-roles';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.15 });

const approved = (currentRole: unknown, requested: unknown) =>
    farmNationRoleChange({ currentRole, status: 'approved', requested });

// ─────────────────────────────────────────────────────────────────────────────
describe('#947 — the change a member can now make', () => {
    it('A BUYER MAY ADD SELLING, and gains the seller role', () => {
        expect(approved('buyer', 'seller')).toEqual({
            kind: 'grant',
            nextRole: 'both',
            rolesToAdd: [FARM_NATION_BUYER_ROLE, FARM_NATION_SELLER_ROLE],
        });
    });

    it('A SELLER MAY ADD BUYING, and gains the buyer role', () => {
        expect(approved('seller', 'buyer')).toEqual({
            kind: 'grant',
            nextRole: 'both',
            rolesToAdd: [FARM_NATION_BUYER_ROLE, FARM_NATION_SELLER_ROLE],
        });
    });

    it('AND THE ROLES IT GRANTS COME FROM THE SHARED CONSTANTS', () => {
        /*
         *   Not the strings. farm-nation-roles exists because _fn_admin once wrote
         *   `roles: ["farmer"]` unconditionally and handed a SELLER role to
         *   somebody who applied as a buyer. A literal here would be a fourth
         *   statement of what "seller" means.
         */
        const { rolesToAdd } = approved('buyer', 'seller') as any;

        expect(rolesToAdd).toContain(FARM_NATION_SELLER_ROLE);
        expect(code('src/lib/farm-nation-role-change.ts'))
            .toContain('from "@/lib/farm-nation-roles"');
        expect(code('src/lib/farm-nation-role-change.ts')).not.toContain('"farmer"');
        expect(code('src/lib/farm-nation-role-change.ts')).not.toContain('"investor"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#947 — it adds and never removes', () => {
    it('BOTH ASKED TO BECOME A BUYER IS A NO-CHANGE, not a demotion', () => {
        //   The hazard. A member holding approved listings who lost the seller
        //   role would keep the listings and lose the screens that manage them:
        //   live rows with inquiries against them, belonging to somebody who can
        //   no longer answer.
        const verdict = approved('both', 'buyer');

        expect(verdict.kind).toBe('no-change');
        expect((verdict as any).reason).toMatch(/already registered to both/i);
    });

    it('AND IT SAYS WHERE TO GO INSTEAD, rather than leaving them guessing', () => {
        expect((approved('both', 'seller') as any).reason).toMatch(/contact support/i);
    });

    it('and no verdict ever produces a narrower role than the one held', () => {
        //   The general form, over every pair. A `grant` that narrowed would be the
        //   stranding above, arrived at from some combination I did not think of.
        const rank = { buyer: 1, seller: 1, both: 2 } as const;

        for (const current of FARM_NATION_ROLES) {
            for (const requested of FARM_NATION_ROLES) {
                const v = approved(current, requested);
                if (v.kind !== 'grant') continue;

                expect({ current, requested, ok: rank[v.nextRole] >= rank[current] })
                    .toEqual({ current, requested, ok: true });
            }
        }
    });

    it('and asking for what you already are is a no-change, not an error', () => {
        //   #587's line, applied here: "ALREADY REGISTERED IS A FACT ABOUT HER, NOT
        //   A FAULT IN HER." The action returns this as success with a sentence.
        for (const role of FARM_NATION_ROLES) {
            expect({ role, kind: approved(role, role).kind }).toEqual({ role, kind: 'no-change' });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#947 — who may not use this door', () => {
    it('AN APPLICATION STILL IN REVIEW IS SENT TO THE RESUBMIT PATH', () => {
        //   Granting here would hand out a role the approval has not yet agreed
        //   to — which is exactly the defect farm-nation-roles was written for.
        for (const status of ['pending', 'rejected', 'revision_required', '', 'suspended']) {
            const verdict = farmNationRoleChange({ currentRole: 'buyer', status, requested: 'seller' });

            expect({ status, kind: verdict.kind }).toEqual({ status, kind: 'refused' });
        }
    });

    it('AND AN APPROVED OR ACTIVE ONE MAY', () => {
        //   The control on the assertion above: if every status were refused, that
         //  loop would pass on a door that admits nobody.
        for (const status of ['approved', 'active']) {
            const verdict = farmNationRoleChange({ currentRole: 'buyer', status, requested: 'seller' });

            expect({ status, kind: verdict.kind }).toEqual({ status, kind: 'grant' });
        }
    });

    it('AND A REQUEST THAT IS NOT ONE OF THE THREE IS REFUSED', () => {
        for (const requested of ['admin', 'farmer', '', null, undefined, 42, 'BUYER']) {
            expect({ requested, kind: approved('buyer', requested).kind })
                .toEqual({ requested, kind: 'refused' });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#947 — an absent role reads as seller, which is not arbitrary', () => {
    it('A ROW WITH NO ROLE RECORDED IS TREATED AS A SELLER', () => {
        /*
         *   farm-nation-roles states why, and this follows it exactly: "Every row
         *   approved before this rule existed was granted `farmer` outright, so
         *   defaulting to it leaves those accounts exactly as they are."
         *
         *   Reading an absent role as BUYER would tell a live land-owner they are
         *   not a seller, and offer them a button to become one they already are.
         */
        expect(approved(undefined, 'seller').kind).toBe('no-change');
        expect(approved(undefined, 'buyer')).toMatchObject({ kind: 'grant', nextRole: 'both' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#947 — and the door is wired where a member can reach it', () => {
    it('THE ACTION EXISTS, IS EXPORTED, AND ASKS THE RULE', () => {
        const action = code('src/app/actions/farm-nation/_fn_onboarding.ts');

        expect(action).toContain('farmNationRoleChange(');
        expect(action).toContain('export const changeFarmNationRoleAction');
        expect(code('src/app/actions/farm-nation/index.ts')).toContain('changeFarmNationRoleAction');
    });

    it('AND IT UNIONS THE ROLES rather than assigning them', () => {
        //   arrayUnion, so a role already held is untouched and a repeated press is
        //   idempotent. An assignment here would remove whatever else the account
        //   holds — including roles from other modules.
        const action = code('src/app/actions/farm-nation/_fn_onboarding.ts');

        expect(action).toContain('FieldValue.arrayUnion(...verdict.rolesToAdd)');
    });

    it('AND IT INVALIDATES THE CACHED PROFILE, or the screen keeps offering it', () => {
        //   #692 The member reads their own role through the cached profile and the
        //   dashboard's whole shape is keyed on it.
        expect(code('src/app/actions/farm-nation/_fn_onboarding.ts'))
            .toContain("invalidateServiceCache(userId, 'farmNation')");
    });

    it('AND THE DASHBOARD OFFERS IT ONLY WHEN THERE IS SOMETHING TO ADD', () => {
        const client = code('src/app/farm-nation/(member)/dashboard/FarmNationDashboardClient.tsx');

        //   `both` gets no card: the answer to "want the other one?" is already yes.
        expect(client).toContain('stats.role === "buyer" ? "seller" : stats.role === "seller" ? "buyer" : null');
        expect(client).toContain('{missingSide && (');
        expect(client).toContain('changeFarmNationRoleAction');
    });

    it('and the card tells the member the listing is still inspected', () => {
        //   The sentence that stops "add selling" reading as "publish whatever you
        //   like". It is also true — every listing is written pending_verification.
        expect(code('src/app/farm-nation/(member)/dashboard/FarmNationDashboardClient.tsx'))
            .toMatch(/inspected and approved/i);
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   narrowing allowed: "both" + "buyer" -> buyer     "BOTH ASKED TO BECOME A
 *     (the stranding hazard)                         BUYER IS A NO-CHANGE" and
 *                                                    the all-pairs invariant
 *   an unapproved status may change its role          "AN APPLICATION STILL IN
 *                                                    REVIEW IS SENT TO THE
 *                                                    RESUBMIT PATH"
 *   every status refused (door admits nobody)         "AND AN APPROVED OR ACTIVE
 *                                                    ONE MAY"
 *   an arbitrary string accepted as a role            "A REQUEST THAT IS NOT ONE
 *                                                    OF THE THREE IS REFUSED"
 *   an absent role read as buyer                      "A ROW WITH NO ROLE
 *                                                    RECORDED IS TREATED AS A
 *                                                    SELLER"
 *   the role literals inlined instead of imported     "THE ROLES IT GRANTS COME
 *                                                    FROM THE SHARED CONSTANTS"
 *   arrayUnion replaced with an assignment            "IT UNIONS THE ROLES"
 *   the cache invalidation dropped                    "IT INVALIDATES THE CACHED
 *                                                    PROFILE"
 *   the card shown to a "both" member                  "THE DASHBOARD OFFERS IT
 *                                                    ONLY WHEN THERE IS
 *                                                    SOMETHING TO ADD"
 */
