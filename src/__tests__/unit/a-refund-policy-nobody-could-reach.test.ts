/**
 * @jest-environment node
 */

/**
 *   #926 A POLICY THE PLATFORM PUBLISHED AND NOBODY COULD REACH, AND TWO
 *   CONSENTS THAT NAME DOCUMENTS IT HAS NEVER WRITTEN.
 *
 *   The batch is app/terms/page, app/refund-policy/page, app/contact/page and
 *   export/onboarding/steps/TermsAcceptanceStep — four files no test had named.
 *
 * ── THE REFUND POLICY ───────────────────────────────────────────────────────
 *
 *   /refund-policy is sixty-four lines with four real sections: Recorded Digital
 *   Trainings, Live Trainings, Cooperative Membership Fees, Chargebacks. Every
 *   one of them is something a member pays for.
 *
 *   `grep -rn '"/refund-policy"' src` found NOT ONE link to it. Not from the live
 *   home-page footer, whose Legal column lists exactly Terms and Privacy; not
 *   from LoginForm or RegisterForm, which link the same pair; and not from
 *   WebsiteFooter's own Legal column, which lists Terms, Privacy, Security and
 *   FAQ. A policy nobody can reach is not published — it is a file.
 *
 *   Linked now from app/page (which is live) and from WebsiteFooter (which #361
 *   records as rendered by nothing, so that one is correctness for the day
 *   somebody mounts it — the same reasoning #359 used in that file).
 *
 * ── AND THE COPYRIGHT YEAR ──────────────────────────────────────────────────
 *
 *   The same footer said "© 2024" in 2026. LoginForm, RegisterForm and
 *   ModuleRegisterPage all already derive it with `new Date().getFullYear()`;
 *   the most-visited public page on the platform was the one outlier, and the
 *   expression it uses now is theirs.
 *
 * ── THE ONE THIS RECORDS RATHER THAN FIXES ──────────────────────────────────
 *
 *   TermsAcceptanceStep asks an export applicant to tick four boxes before the
 *   platform will take their money. Two of them name documents:
 *
 *       "I have read and agree to the INVESTMENT TERMS AND CONDITIONS"  → /terms
 *       "I agree to the ESCROW SERVICE TERMS for fund protection"       → /terms
 *
 *   /terms has eight numbered sections — Services, Account Responsibility,
 *   Payment Terms, Intellectual Property Rights, Disclaimer of Guarantees,
 *   Limitation of Liability, Governing Law, Dispute Resolution — and the words
 *   "escrow" and "investment" appear in it ZERO times each. Measured, not read.
 *
 *   So the platform records a consent to terms it has never published, on the
 *   flow where an investor commits funds, and escrow is where the money sits.
 *
 *   NOT FIXED HERE, and this is the line: both available fixes are legal
 *   drafting. Writing escrow and investment sections is the owner's, with their
 *   lawyer. Rewording the consent so it stops naming them is also the owner's,
 *   because it changes what an applicant is agreeing to. WebsiteFooter's own #359
 *   note draws the same line about a security page — "an owner decision, not
 *   something to invent here".
 *
 *   It is a LEDGER rather than a comment so that the day those sections are
 *   written, the count improves and this file asks to be updated instead of
 *   quietly going stale.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';

const ROOT = process.cwd();
const raw = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) =>
    stripComments(raw(rel), { label: rel, minRetainedRatio: 0.2 });

const HOME = 'src/app/page.tsx';
const FOOTER = 'src/components/layout/WebsiteFooter.tsx';
const TERMS = 'src/app/terms/page.tsx';
const REFUND = 'src/app/refund-policy/page.tsx';
const CONTACT = 'src/app/contact/page.tsx';
const STEP = 'src/app/export/onboarding/steps/TermsAcceptanceStep.tsx';

/** Every shipping .tsx that links to `href`. */
function linkersOf(href: string): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(join(ROOT, dir))) {
            const rel = `${dir}/${entry}`;
            if (statSync(join(ROOT, rel)).isDirectory()) {
                if (!['node_modules', '.next', '__tests__'].includes(entry)) walk(rel);
                continue;
            }
            if (!entry.endsWith('.tsx')) continue;
            //   The page itself does not count as a link to itself.
            if (rel.startsWith(`src/app${href}/`)) continue;

            //   NO RETENTION FLOOR on a whole-tree walk — the floor guards a
            //   caller reasoning about ONE file, and across 700 it throws on the
            //   heavily-commented ones and kills the sweep. The first version of
            //   this used the default and reported ZERO linkers for /terms, which
            //   would have read as a far bigger finding than the real one.
            const src = stripComments(raw(rel), { label: rel, minRetainedRatio: 0 });
            if (src.includes(`href="${href}"`)) found.push(rel);
        }
    };
    walk('src');
    return found.sort();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#926 — the refund policy can be reached', () => {
    it('THE CONTROL: the page is real and covers what members pay for', () => {
        //   Linking a stub would be worse than not linking it.
        const page = code(REFUND);

        for (const section of ['Recorded Digital Trainings', 'Live Trainings',
            'Cooperative Membership Fees', 'Chargebacks']) {
            expect(page).toContain(section);
        }
    });

    it('THE DEFECT: it is linked now, from the footer people actually see', () => {
        const linkers = linkersOf('/refund-policy');

        expect(linkers).toContain(HOME);
    });

    it('and from WebsiteFooter, which is still rendered by nothing', () => {
        //   #361's finding, unchanged by this one: the component is an orphan.
        //   The link is here so it is correct if that ever changes, and the
        //   assertion above is the one that makes the policy reachable today.
        expect(code(FOOTER)).toContain('{ name: "Refund Policy", href: "/refund-policy" }');
        expect(raw(FOOTER)).toContain('THIS FILE IS NOT RENDERED');
    });

    it('POSITIVE CONTROL: the sweep really finds links, and the home page has the others', () => {
        //   A sweep that matched nothing would pass `toContain` on nothing and
        //   fail — but it would pass the ledger below, so it is checked directly.
        expect(linkersOf('/terms').length).toBeGreaterThanOrEqual(5);
        expect(linkersOf('/privacy')).toContain(HOME);
    });

    it('THE LEDGER — published policy pages with no link anywhere', () => {
        //   Was one. A second is a page somebody wrote and nobody can read.
        const POLICIES = ['/terms', '/privacy', '/refund-policy'];
        const unreachable = POLICIES.filter((href) => linkersOf(href).length === 0);

        expect(unreachable).toEqual([]);
        expect(ledgerVerdict(unreachable.length, 0)).toBe(LEDGER_HELD);
    });

    it('and the copyright year is derived, as it is on the three auth screens', () => {
        expect(code(HOME)).toContain('new Date().getFullYear()');
        expect(code(HOME)).not.toContain('© 2024');

        for (const rel of ['src/components/auth/LoginForm.tsx',
            'src/components/auth/RegisterForm.tsx']) {
            expect(code(rel)).toContain('new Date().getFullYear()');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#926 — two consents that name documents /terms does not contain', () => {
    it('the step really does name them, and really does link to /terms', () => {
        //   Without this the ledger below is arguing with nobody.
        const step = code(STEP);

        expect(step).toContain('Investment Terms and Conditions');
        expect(step).toContain('Escrow Service Terms');
        expect((step.match(/href="\/terms"/g) ?? []).length).toBe(2);
    });

    it('and it will not let an applicant past without ticking all four', () => {
        //   The consent is compulsory, which is what makes the gap matter.
        const step = code(STEP);

        expect(step).toContain('acceptedInvestment && acceptedRisk && acceptedEscrow && acceptedPrivacy');
        expect(step).toContain('disabled={!allAccepted || isSubmitting}');
    });

    it('THE MEASUREMENT: /terms contains neither word', () => {
        const terms = raw(TERMS);

        expect(terms.toLowerCase()).not.toContain('escrow');
        expect(terms.toLowerCase()).not.toContain('investment');
    });

    it('THE CONTROL: /terms is a real terms page, not an empty one', () => {
        //   Otherwise "it does not mention escrow" would be true of a blank file
        //   and would mean nothing.
        const terms = code(TERMS);

        for (const section of ['Services', 'Account Responsibility', 'Payment Terms',
            'Limitation of Liability', 'Governing Law', 'Dispute Resolution']) {
            expect(terms).toContain(section);
        }
    });

    it('THE LEDGER — consents naming a document their link does not contain', () => {
        //   Two. Lower this when /terms gains the sections, and say which.
        //   Raising it means a third consent was written against a document
        //   nobody published.
        const step = code(STEP);
        const NAMED = ['Investment Terms and Conditions', 'Escrow Service Terms'];
        const terms = raw(TERMS).toLowerCase();

        const unbacked = NAMED.filter((name) => {
            const subject = name.split(' ')[0].toLowerCase();  // "investment" / "escrow"
            return step.includes(name) && !terms.includes(subject);
        });

        expect(unbacked).toEqual(NAMED);
        expect(ledgerVerdict(unbacked.length, 2)).toBe(LEDGER_HELD);
    });

    it('while the other two consents ARE backed by the pages they link', () => {
        //   Risk Disclosure makes no reference to a document, and the privacy
        //   consent links /privacy, which exists and is a privacy policy. So the
        //   ledger above is about two specific claims, not about consent copy in
        //   general.
        const step = code(STEP);

        expect(step).toContain('accept full responsibility for my investment decisions');
        expect(step).toContain('href="/privacy"');
        expect(code('src/app/privacy/page.tsx').toLowerCase()).toContain('privacy');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#926 — the contact page, where one address was typed out', () => {
    /**
     * I wrote this block expecting to record a clean file. The assertion failed,
     * which is the only reason the finding exists — and is why a "clean" verdict
     * is worth asserting rather than declaring.
     *
     * Four channels on this page read COMPANY_INFO: the cooperative email, the
     * general phone, the WhatsApp number and the address. The fifth, the fallback
     * inside the form's catch block, was the literal
     * "info@easysalesexport.com" — which AGREES with
     * COMPANY_INFO.contact.general.email today, and so would have gone wrong
     * silently the day the address moved, on the one path that runs when the form
     * has just failed and the address is all the person has left.
     */
    it('reads every channel from COMPANY_INFO, including the failure path', () => {
        const contact = code(CONTACT);

        expect(contact).toContain('COMPANY_INFO.contact.general.email');
        //   No address literal left anywhere in the file.
        expect(contact).not.toMatch(/[\w.]+@[\w.]+\.(com|ng|org)/);
    });

    it('THE CONTROL: the four channels that were always right still are', () => {
        const contact = code(CONTACT);

        for (const field of ['contact.cooperative.email', 'contact.general.phone',
            'contact.general.whatsapp', 'contact.cooperative.address']) {
            expect(contact).toContain(`COMPANY_INFO.${field}`);
        }
    });

    it('and the constant it now reads is a real address', () => {
        //   Pointing the failure message at an undefined field would be worse
        //   than the literal.
        const constants = code('src/lib/constants.ts');

        //   No `s` flag: a character class already crosses newlines, and the
        //   repo targets a lower ES level than dotAll needs.
        expect(constants).toMatch(/general:\s*\{[^}]*email:\s*"[^"@]+@[^"]+"/);
    });
});
