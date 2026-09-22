/**
 * @jest-environment node
 */

/**
 * Farm Nation asked what you were, then granted you the other thing.
 *
 *   THE OWNER: "when users sign up as sellers they can't have buyers features
 *   on their dashboards ... and this also applies to Farm Nation", and then
 *   "yes add the buyer/seller question to farm nation onboarding".
 *
 *   THE QUESTION WAS ALREADY THERE. I had reported the opposite — that Farm
 *   Nation "has zero occurrences of accountType" and therefore had no buyer /
 *   seller concept at all. It has one; it is called `role`, not `accountType`,
 *   and the onboarding has a dedicated step for it:
 *
 *       role: z.enum(["buyer", "seller", "both"])
 *
 *   with the right roles derived from it — `investor` for a buyer, `farmer` for
 *   a seller. A grep for the wrong field name is not evidence of absence, and
 *   this file exists partly so the claim is now checked rather than asserted.
 *
 *   WHAT WAS ACTUALLY BROKEN was the approval. `_fn_admin` wrote
 *   `roles: ["farmer"]` on create and `arrayUnion("farmer")` on update, both
 *   unconditional, reading nothing. So an applicant who answered "buyer" — and
 *   was correctly given `investor` at onboarding — was handed `farmer`, a
 *   SELLER role, the moment an administrator approved them. The module's own
 *   answer, overwritten by the screen meant to confirm it.
 *
 *   That is the marketplace defect exactly: checkModuleAccess Layer 2.11 also
 *   granted `seller` without reading `accountType`. Two modules, one shape.
 *
 *   Verified by mutation: restoring the unconditional `["farmer"]` fails the
 *   first two tests.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import {
    rolesForFarmNationRole,
    FARM_NATION_BUYER_ROLE,
    FARM_NATION_SELLER_ROLE,
} from '@/lib/farm-nation-roles';
import { LAND_BUYER_ROLES, LAND_SELLER_ROLES } from '@/lib/role-app-mapping';
import { navItemAllowedForRoles } from '@/lib/nav-visibility';

describe('the module asked, and the approval ignored the answer', () => {
    it('A BUYER GETS THE BUYER ROLE AND NOT THE SELLER ONE', () => {
        expect(rolesForFarmNationRole('buyer')).toEqual([FARM_NATION_BUYER_ROLE]);
        expect(rolesForFarmNationRole('buyer')).not.toContain(FARM_NATION_SELLER_ROLE);
    });

    it('A SELLER GETS THE SELLER ROLE, AND "both" GETS BOTH', () => {
        expect(rolesForFarmNationRole('seller')).toEqual([FARM_NATION_SELLER_ROLE]);
        expect(rolesForFarmNationRole('both')).toEqual(
            expect.arrayContaining([FARM_NATION_SELLER_ROLE, FARM_NATION_BUYER_ROLE]));
        expect(rolesForFarmNationRole('both')).toHaveLength(2);
    });

    it('AN ABSENT ANSWER KEEPS TODAY\'S SELLER DEFAULT — nobody live is demoted', () => {
        //   Every row approved before this rule was granted "farmer" outright.
        //   Demoting a live land-owner to fix a classification bug would be a
        //   worse failure than the one being fixed.
        for (const absent of [undefined, null, '', '   ', 42, {}]) {
            expect(rolesForFarmNationRole(absent)).toEqual([FARM_NATION_SELLER_ROLE]);
        }
    });

    it('CASE AND PADDING DO NOT CHANGE THE ANSWER', () => {
        expect(rolesForFarmNationRole('  BUYER ')).toEqual([FARM_NATION_BUYER_ROLE]);
        expect(rolesForFarmNationRole('Both')).toHaveLength(2);
    });

    it('THE APPROVAL NO LONGER HARDCODES "farmer"', () => {
        const src = readFileSync('src/app/actions/farm-nation/_fn_admin.ts', 'utf8');

        expect(src).not.toContain('roles: ["farmer"]');
        expect(src).not.toContain('FieldValue.arrayUnion("farmer")');
        expect(src).toContain('rolesForFarmNationRole');
    });

    it('AND THE ONBOARDING SHARES THE RULE RATHER THAN RESTATING IT', () => {
        //   It was stated there and nowhere else, which is precisely why the
        //   approval could contradict it without anything noticing.
        const src = readFileSync('src/app/actions/farm-nation/_fn_onboarding.ts', 'utf8');

        expect(src).toContain('rolesForFarmNationRole');
        expect(src).not.toContain('roles.push("investor")');
        expect(src).not.toContain('roles.push("farmer")');
    });

    it('THE QUESTION REALLY IS ASKED — checked, not assumed', () => {
        //   The claim I got wrong, now a test. The enum and the step both.
        const onboarding = readFileSync('src/app/actions/farm-nation/_fn_onboarding.ts', 'utf8');
        expect(onboarding).toContain('role: z.enum(["buyer", "seller", "both"])');

        const client = readFileSync(
            'src/app/farm-nation/onboarding/FarmNationOnboardingClient.tsx', 'utf8');
        expect(client).toContain('id: "role"');
    });

    it('THE NAV SEPARATES THE TWO SIDES — buyer, seller, and both', () => {
        const buying = { rolesAny: LAND_BUYER_ROLES };
        const selling = { rolesAny: LAND_SELLER_ROLES };

        const buyerOnly = rolesForFarmNationRole('buyer');
        const sellerOnly = rolesForFarmNationRole('seller');
        const bothSides = rolesForFarmNationRole('both');

        expect(navItemAllowedForRoles(buying, buyerOnly)).toBe(true);
        expect(navItemAllowedForRoles(selling, buyerOnly)).toBe(false);

        expect(navItemAllowedForRoles(selling, sellerOnly)).toBe(true);
        expect(navItemAllowedForRoles(buying, sellerOnly)).toBe(false);

        expect(navItemAllowedForRoles(buying, bothSides)).toBe(true);
        expect(navItemAllowedForRoles(selling, bothSides)).toBe(true);
    });

    it('AND THE FARM NATION ENTRIES ACTUALLY CARRY THOSE GATES', () => {
        const src = readFileSync('src/components/layout/ModuleSidebar.tsx', 'utf8');
        /*
         *   The nav ENTRY, not the first line that mentions the name. This file
         *   carries long comments that quote entry names, and matching those
         *   made this assertion read a paragraph and fail on it — so the match
         *   requires the two things only an entry has.
         */
        const lineFor = (name: string) =>
            src.split('\n').find((l) =>
                l.includes(`name: "${name}"`) && l.includes('href:')) ?? `${name}: MISSING`;

        for (const buying of ['My Purchases', 'My Inquiries', 'My Offers']) {
            expect(`${buying}: ${lineFor(buying)}`).toContain('LAND_BUYER_ROLES');
        }
        for (const selling of ['My Properties', 'List Land']) {
            expect(`${selling}: ${lineFor(selling)}`).toContain('LAND_SELLER_ROLES');
        }
    });
});
