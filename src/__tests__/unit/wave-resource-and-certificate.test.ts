/**
 * WAVE resources and certificates: two collections, each managed by two writers
 * that did not agree on a field name.
 *
 * RESOURCES — WHAT WAS ACTUALLY BROKEN
 * ------------------------------------
 * `COLLECTIONS.WAVE_RESOURCES` has two create actions and two delete actions,
 * across two files, and each pair used its own field for "withdrawn":
 *
 *   resource-actions.ts        upload writes isActive: true
 *                             delete writes isActive: false
 *                             list   queries isActive == true
 *                             download refuses on isActive === false
 *
 *   wave/_wv_admin_resources.ts create writes NEITHER
 *                               delete writes deleted: true
 *
 *   wave/_wv_resources.ts       list   filters NEITHER
 *
 * Three live effects. A resource uploaded from the WAVE admin screen has no
 * `isActive`, so `isActive == true` never matched it and it was invisible in the
 * listing behind /wave/(member)/resources. A resource deleted from that screen got
 * `deleted: true`, which nothing read — so it stayed listed and stayed
 * downloadable. And the other member listing filtered on neither field, so it
 * showed resources withdrawn by either path.
 *
 * CERTIFICATES
 * ------------
 * Every certificate was issued to "Member", because the name came from
 * `userData.name` and nothing writes `name` onto a user. The verification URL
 * pointed at a route that does not exist. And the unified certificates endpoint
 * read four field names, none of which the writer used.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    isResourceWithdrawn,
    isResourceVisible,
    RESOURCE_LIVE_FIELDS,
    RESOURCE_WITHDRAWN_FIELDS,
} from '@/lib/wave-resource-visibility';

const ADMIN_RESOURCES = 'src/app/actions/wave/_wv_admin_resources.ts';
const RESOURCE_ACTIONS = 'src/app/actions/resource-actions.ts';
const MEMBER_RESOURCES = 'src/app/actions/wave/_wv_resources.ts';
const CERTIFICATES = 'src/app/actions/wave/_wv_certificates.ts';
const VERIFY_ROUTE = 'src/app/api/academy/verify/[certificateId]/route.ts';
const CERTS_ROUTE = 'src/app/api/academy/certificates/route.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('one definition of a withdrawn resource', () => {
    it('honours both field names live rows use', () => {
        expect(isResourceWithdrawn({ isActive: false })).toBe(true);
        expect(isResourceWithdrawn({ deleted: true })).toBe(true);
    });

    it('treats a resource with neither field as visible', () => {
        // THE decision, and the reason the listing defect was not "fixed" by
        // treating missing as withdrawn: every resource created through the WAVE
        // admin screen lacks both fields, so that would have hidden the whole
        // existing library.
        expect(isResourceWithdrawn({})).toBe(false);
        expect(isResourceVisible({ title: 'Export guide' })).toBe(true);
        expect(isResourceWithdrawn({ isActive: true })).toBe(false);
    });

    it('treats a missing document as withdrawn, not visible', () => {
        expect(isResourceWithdrawn(null)).toBe(true);
        expect(isResourceWithdrawn(undefined)).toBe(true);
    });

    it('writes both spellings, because two readers query one of them in SQL', () => {
        expect(RESOURCE_LIVE_FIELDS).toEqual({ isActive: true, deleted: false });
        expect(RESOURCE_WITHDRAWN_FIELDS).toEqual({ isActive: false, deleted: true });
    });
});

describe('both create actions mark a resource live', () => {
    it('the WAVE admin one, which set neither field', () => {
        const src = code(ADMIN_RESOURCES);
        expect(src).toContain('...RESOURCE_LIVE_FIELDS,');
    });

    it('the other one too, through the same constant', () => {
        const src = code(RESOURCE_ACTIONS);
        expect(src).toContain('...RESOURCE_LIVE_FIELDS,');
        // And no longer through its own literal, which is how the two drifted.
        expect(src).not.toMatch(/^\s*isActive: true,$/m);
    });
});

describe('both delete actions actually withdraw', () => {
    it('the WAVE admin one no longer writes a field nothing reads', () => {
        const src = code(ADMIN_RESOURCES);

        expect(src).toContain('...RESOURCE_WITHDRAWN_FIELDS,');
        expect(src).not.toMatch(/^\s*deleted: true,$/m);
    });

    it('the other one goes through the same constant', () => {
        const src = code(RESOURCE_ACTIONS);
        expect(src).toContain('...RESOURCE_WITHDRAWN_FIELDS,');
        expect(src).not.toMatch(/update\(\{ isActive: false,/);
    });
});

describe('every reader uses the shared predicate', () => {
    it('the download guard, which knew only one of the two deletes', () => {
        // It tested `isActive === false`, so a resource withdrawn through the WAVE
        // admin screen — `deleted: true` — was still served to anyone with the id.
        const src = code(RESOURCE_ACTIONS);

        expect(src).toContain('if (isResourceWithdrawn(resource as any))');
        expect(src).not.toContain('(resource as any).isActive === false');
    });

    it('the listing that excluded every WAVE-admin-created resource', () => {
        // `.where("isActive", "==", true)` cannot match a row without the field,
        // and "true or absent" is not one equality — so the filter moves to memory
        // rather than the collection being migrated to satisfy a reader.
        const src = code(RESOURCE_ACTIONS);

        expect(src).not.toContain('.where("isActive", "==", true)');
        expect(src).toContain('snapshot.docs.filter((doc) => !isResourceWithdrawn(doc.data()))');
    });

    it('the listing that filtered nothing at all', () => {
        // Was pinned to one exact line:
        //
        //   expect(src).toContain('const visibleDocs = snapshot.docs.filter(...)')
        //
        // which asserted a SPELLING, not a behaviour, and broke the moment #196
        // replaced the single fetch with a scan — while the property it meant to
        // protect, "withdrawn resources never reach the member", was untouched.
        // The behaviour is proven by execution in the #196 suite; this keeps
        // only the structural half that a test cannot easily execute: the filter
        // must run before the page is cut, or a page comes back short.
        const src = code(MEMBER_RESOURCES);

        expect(src).toContain('!isResourceWithdrawn(doc.data())');
        const filterAt = src.indexOf('!isResourceWithdrawn(doc.data())');
        const sliceAt = src.indexOf('visibleDocs.slice(0, pageSize)');
        expect(filterAt).toBeGreaterThan(-1);
        expect(sliceAt).toBeGreaterThan(filterAt);
    });

    it('does not filter the training events listing by mistake', () => {
        // The same snapshot/hasMore/slice shape appears twice in that file; the
        // second is WAVE_TRAINING_EVENTS, which has its own status filter and no
        // notion of withdrawal.
        //
        // This counted occurrences and required exactly ONE, which made it fail
        // when #200 gave the download action the withdrawn check it had always
        // lacked — a correct new guard reported as a regression. A count is the
        // wrong instrument: what matters is WHERE the predicate is used, so that
        // is what is asserted.
        const src = code(MEMBER_RESOURCES);

        const eventsBlock = src.slice(src.indexOf('_getWaveTrainingEventsAction'));
        const eventsBody = eventsBlock.slice(0, eventsBlock.indexOf('uploadWaveResourceAction'));
        expect(eventsBody).not.toContain('isResourceWithdrawn');
    });
});

describe('a certificate carries the member\'s name', () => {
    it('resolves it through the canonical resolver', () => {
        // `userData?.name || "Member"` — and nothing writes `name` onto a user.
        // Registration writes fullName, firstName and lastName. So the fallback
        // always won and every certificate ever issued said "Member".
        const src = code(CERTIFICATES);

        expect(src).not.toContain('userData?.name || "Member"');
        expect(src).toContain('extractCanonicalUser(userData ?? {})');
        expect(src).toContain('const memberName = canonical.name || "Member"');
    });

    it('says so when it genuinely cannot resolve one', () => {
        const src = source(CERTIFICATES);
        expect(src).toContain('No name could be resolved');
    });
});

describe('the certificate number is unguessable and unique', () => {
    it('is not Math.random', () => {
        // The number exists so a third party can confirm a credential is genuine.
        // Six base-36 characters from a non-cryptographic generator is guessable,
        // and at fifteen thousand certificates collides a few percent of the time
        // with nothing checking.
        const src = code(CERTIFICATES);

        expect(src).not.toContain('Math.random()');
        expect(src).toContain('randomUUID()');
    });

    it('keeps enough of it to matter', () => {
        const src = code(CERTIFICATES);
        expect(src).toMatch(/randomUUID\(\)\.replace\(\/-\/g, ""\)\.slice\(0, 12\)/);
    });
});

describe('the verification link resolves', () => {
    it('no longer points at a route that does not exist', () => {
        // `/wave/verify-certificate/${certNumber}` has no page and no handler
        // anywhere in the app. A credential carrying a 404 is worse than one
        // carrying no link, because the link is the part a verifier trusts.
        const src = code(CERTIFICATES);

        expect(src).not.toContain('/wave/verify-certificate/');
        expect(src).toContain('verificationUrl: `/academy/verify/${certId}`');
    });

    it('and the verifier looks in the WAVE collection', () => {
        // The platform issues into two collections and its only public verifier
        // checked one.
        const src = code(VERIFY_ROUTE);

        expect(src).toContain('COLLECTIONS.WAVE_CERTIFICATES');
        expect(src).toContain('if (waveDoc?.exists)');
        expect(src).toContain('programme: "wave"');
    });

    it('checks the academy collection first, so existing ids cost one lookup', () => {
        const src = code(VERIFY_ROUTE);
        const academyAt = src.indexOf('COLLECTIONS.CERTIFICATES');
        const waveAt = src.indexOf('COLLECTIONS.WAVE_CERTIFICATES');

        expect(academyAt).toBeGreaterThan(-1);
        expect(waveAt).toBeGreaterThan(academyAt);
        expect(src).toContain('if (!certificateDoc.exists) {');
    });
});

describe('the unified certificates endpoint reads the fields the writer writes', () => {
    it('queries both id fields, because live rows use only one', () => {
        // It queried `userId` while the writer stored `memberId`, so the branch
        // returned nothing at all.
        const src = code(CERTS_ROUTE);

        expect(src).toContain('.where("userId", "==", userId)');
        expect(src).toContain('.where("memberId", "==", userId)');
        expect(src).toContain('const seenWaveIds = new Set<string>()');
    });

    it('reads the writer\'s names for kind and date', () => {
        // `d.type` and `d.issuedAt` were undefined, so courseName read
        // "WAVE – undefined" and every certificate was dated today.
        const src = code(CERTS_ROUTE);

        expect(src).toContain('d.certificateType ?? d.type');
        expect(src).toContain('d.issuedDate ?? d.issuedAt ?? d.createdAt');
    });

    it('does not date an undated certificate to now', () => {
        // Defaulting to the current time made every row look freshly issued, which
        // is the kind of wrong that looks right.
        const src = code(CERTS_ROUTE);
        expect(src).toContain('new Date(0).toISOString()');
    });

    it('prefers the programme name over a synthesised one', () => {
        const src = code(CERTS_ROUTE);
        expect(src).toContain('courseName: d.programName');
    });
});
