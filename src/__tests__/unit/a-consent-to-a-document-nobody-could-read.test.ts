/**
 * @jest-environment node
 */

/**
 *   #961 FOUR CONSENTS NAMED A DOCUMENT THE PAGE THEY LINKED TO DID NOT CONTAIN.
 *
 *   The export programme's onboarding asks an investor to tick:
 *
 *       "I have read and agree to the Investment Terms and Conditions"
 *
 *   linked to /terms. That page has eight sections — services, account
 *   responsibility, payment, intellectual property, guarantees, liability,
 *   governing law, dispute resolution — and NOT ONE WORD about investment. The
 *   same step does it again for "Escrow Service Terms", with "for fund
 *   protection" beside it, which is a promise about somebody's money.
 *
 *   So the member clicked, found no such document, and ticked the box anyway,
 *   because the box is required to continue. The consent recorded against their
 *   account says they read something that was never published.
 *
 *   #926 measured /terms covering two of six modules. This is the half of that
 *   finding where the missing text is one somebody is asked to AGREE to, which
 *   is why it is a defect rather than a gap.
 *
 * ── WHY THE DEAD-LINK SCAN COULD NOT SEE IT ─────────────────────────────────
 *
 *   lib/testing/route-link-scan already sweeps internal links, and /terms
 *   EXISTS — so every one of these passed. "The route resolves" and "the
 *   document is there" are different questions, and only the first was being
 *   asked. The link was not dead; it was pointed at the wrong document, which no
 *   type checker, linter or route scan can notice.
 *
 * ── WHAT WAS DONE, AND WHAT DELIBERATELY WAS NOT ────────────────────────────
 *
 *   NOT drafted terms. Investment and escrow terms for a flow where somebody
 *   commits funds against Nigerian agricultural export windows are a lawyer's
 *   work — SEC Nigeria on collective investment schemes, CBN on holding
 *   third-party funds — and text invented here would read as authoritative while
 *   binding nobody usefully. The owner's decision, and the right one.
 *
 *   Instead: /terms/investment and /terms/escrow exist, each stating in its own
 *   words that the module-specific terms are not published yet, naming what IS
 *   in force with links, and saying how to ask. The two consents point there.
 *
 *   And two more links said "Terms of Service" while the document is titled
 *   "Terms and Conditions" — the right document under the wrong name. Renamed to
 *   match, which changes what nobody agrees to and makes the label true.
 *
 *   THE REMAINING GAP, RECORDED RATHER THAN PAPERED OVER: the Risk Disclosure
 *   consent on the same step links NOWHERE. It is a self-contained
 *   acknowledgement — "I understand the risks … and accept full responsibility"
 *   — so it names no absent document and this rule has nothing to say about it.
 *   Whether an investment platform should publish a formal risk disclosure is a
 *   question for the owner and their advisers, not a defect this suite can
 *   assert.
 */

import { describe, it, expect } from '@jest/globals';
import { join } from 'path';
import { readFileSync } from 'fs';
import {
    scanConsentDocumentLinks,
    consentsNamingAnAbsentDocument,
} from '@/lib/testing/route-link-scan';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';

const APP = join(process.cwd(), 'src/app');
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
describe('#961 — a consent names a document the member can actually read', () => {
    it('NO CONSENT LINKS TO A PAGE WITHOUT THE DOCUMENT IT NAMED — recorded 0', () => {
        /*
         *   Four when first measured: two in export/onboarding naming absent
         *   documents, two naming /terms by a title it does not carry.
         */
        const RECORDED_ABSENT = 0;

        const links = scanConsentDocumentLinks(APP);
        const absent = consentsNamingAnAbsentDocument(links);

        /*
         *   VACUITY FLOOR, and it is the assertion that matters most here: a
         *   ledger of zero is what a broken scanner reports too. Nine of these
         *   links exist, so if the scan stops finding them the count goes to
         *   zero and looks like success.
         */
        expect(links.length).toBeGreaterThanOrEqual(9);

        expect({ absent: absent.map((l) => `${l.file} "${l.label}" -> ${l.href}`) })
            .toEqual({ absent: [] });
        expect(ledgerVerdict(absent.length, RECORDED_ABSENT)).toBe(LEDGER_HELD);
    });

    it('AND EVERY ONE OF THEM RESOLVES TO A ROUTE THAT EXISTS', () => {
        //   The weaker property the dead-link scan already covers, asserted here
        //   too because this rule's own check depends on it: a missing route
        //   cannot contain a document, so the two failures would be
        //   indistinguishable without this.
        const links = scanConsentDocumentLinks(APP);

        expect(links.filter((l) => !l.routeExists)).toEqual([]);
    });

    it('THE TWO EXPORT CONSENTS POINT AT THEIR OWN DOCUMENTS, not the general terms', () => {
        /*
         *   Pinned by href rather than by count, so this cannot be satisfied by
         *   some other consent moving. These two are the reported defect.
         */
        const links = scanConsentDocumentLinks(APP);
        const byLabel = (label: string) => links.find((l) => l.label === label);

        expect(byLabel('Investment Terms and Conditions')?.href).toBe('/terms/investment');
        expect(byLabel('Escrow Service Terms')?.href).toBe('/terms/escrow');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#961 — and those pages are honest about what they do not yet contain', () => {
    /**
     * The scan proves the member reaches a page about the right subject. It
     * cannot prove that page contains real terms — so these assert the pages say
     * so themselves. A placeholder that reads like finished terms would satisfy
     * the ledger above and mislead worse than the original defect.
     */
    const PLACEHOLDERS = [
        'src/app/terms/investment/page.tsx',
        'src/app/terms/escrow/page.tsx',
    ];

    it('EACH SAYS PLAINLY THAT THE TERMS ARE NOT PUBLISHED YET', () => {
        for (const file of PLACEHOLDERS) {
            const src = read(file);

            expect({ file, states: src.includes('not yet published') })
                .toEqual({ file, states: true });
        }
    });

    it('AND EACH NAMES WHAT IS IN FORCE, with a link the member can follow', () => {
        //   "These terms do not exist" on its own leaves somebody with nothing.
        //   Both pages have to point at the terms that DO govern them.
        for (const file of PLACEHOLDERS) {
            const src = read(file);

            expect({ file, terms: src.includes('href="/terms"') })
                .toEqual({ file, terms: true });
            expect({ file, privacy: src.includes('href="/privacy"') })
                .toEqual({ file, privacy: true });
        }
    });

    it('AND EACH GIVES A WAY TO ASK, since both tell the member to', () => {
        //   A page that says "please ask us" and then gives no address is the
        //   same defect one level down.
        for (const file of PLACEHOLDERS) {
            const src = read(file);

            expect({ file, contactable: /mailto:|href="\/contact"/.test(src) })
                .toEqual({ file, contactable: true });
        }
    });

    it('THE CONTROL: they are not silently empty pages', () => {
        /*
         *   Every assertion above is satisfiable by a file containing four
         *   strings and nothing else. These are pages a member is sent to from a
         *   consent, so they have to be pages.
         */
        for (const file of PLACEHOLDERS) {
            const src = read(file);

            expect(src.length).toBeGreaterThan(1500);
            expect(src).toMatch(/export default function/);
            //   The document's own title, which is also what the scan matches on.
            expect(src).toMatch(/<h1[^>]*>\s*\n?\s*(Investment Terms and Conditions|Escrow Service Terms)/);
        }
    });
});
