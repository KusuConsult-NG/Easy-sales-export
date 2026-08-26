/**
 * @jest-environment node
 */

/**
 *   #312 BOTH SIDES OF A DISPUTE WERE TOLD TO WATCH THEIR EMAIL. THE DISPUTE
 *        PATH SENDS EVERYTHING EXCEPT EMAIL.
 *
 *        A marketplace order in dispute shows a banner on each party's order
 *        page:
 *
 *          seller: "Our team is reviewing this dispute.
 *                   Please check your email for updates."
 *          buyer:  "Our team is reviewing this dispute.
 *                   We'll reach out via your registered email."
 *
 *        resolveDisputeAction notifies the initiator and the respondent through
 *        createNotificationAction, then sends an SMS and a push to both. It
 *        sends no email, and neither does createDisputeAction. Nothing on the
 *        dispute surface imports the mail sender at all.
 *
 *        So the two screens named the ONE channel that is never used and left
 *        out the three that are, on a flow where the outcome moves escrow
 *        money. A seller watching their inbox sees nothing and concludes the
 *        dispute is still open; the resolution is sitting in the bell icon.
 *
 *        This is #290's family — a screen asserting something the code cannot
 *        deliver — and the same "two copies, both wrong" shape as #308 and
 *        #310. Both banners now name what actually happens.
 *
 * WHY THE COPY MOVED AND THE CODE DID NOT
 * ---------------------------------------
 * Adding a dispute email is a product decision — it is a message to a member
 * about their money, and its wording, timing and unsubscribe behaviour are not
 * mine to invent. Three channels already carry the outcome. The defect is the
 * claim, so the claim is what changed.
 *
 *   ALSO RECORDED: /verify-status AND /verify-id ARE UNREACHABLE.
 *
 *        Both are declared in route-manifest.ts twice over — as protected paths
 *        and as shared-domain paths — and nothing in the codebase links to,
 *        redirects to, or pushes either one. /verify-status tells the visitor
 *        "You will receive an email once your verification is complete", which
 *        no code sends. It is left as it is: correcting copy on a page no user
 *        can arrive at would only make the dead page look maintained. Pinned
 *        below so that whoever wires it up finds this first.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const SELLER = 'src/app/marketplace/seller/orders/[id]/page.tsx';
const BUYER = 'src/app/marketplace/buyer/orders/[id]/page.tsx';
const RESOLVER = 'src/app/actions/marketplace/_escrow_disputes.ts';

const raw = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');
const code = (rel: string) => stripComments(raw(rel), { label: rel });

function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of readdirSync(dir)) {
            if (e === 'node_modules' || e === '__tests__') continue;
            const full = join(dir, e);
            if (statSync(full).isDirectory()) walk(full);
            else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full.slice(ROOT.length + 1));
        }
    };
    walk(join(ROOT, 'src'));
    return out.sort();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#312 — the dispute banner names a channel that is used', () => {
    it.each([[SELLER], [BUYER]])('%s no longer sends the member to their inbox', (rel) => {
        // THE test, on stripped source so the quoted old copy in the comment
        // beside the fix cannot satisfy it.
        expect(code(rel)).not.toMatch(/check your email|registered email/i);
    });

    it.each([[SELLER], [BUYER]])('%s names in-app and SMS, which is what happens', (rel) => {
        expect(code(rel)).toMatch(/notified here and by SMS/);
    });

    it.each([
        [SELLER, /Please check your email for updates\./],
        [BUYER, /We'll reach out via your registered email\./],
    ])('%s keeps its OWN old sentence in a comment, so it is findable', (rel, sentence) => {
        // A bare /email/i here would have passed on either file's comment, or
        // on any stray mention — which is not evidence that THIS banner's old
        // wording is still greppable.
        expect(raw(rel as string)).toMatch(sentence as RegExp);
    });

    it('BECAUSE THE DISPUTE PATH SENDS NO EMAIL — the premise, checked', () => {
        // If somebody adds a dispute email later this fails, and that failure
        // is correct: it says the banners may name email again.
        const disputeFiles = sourceFiles().filter((f) => /dispute/i.test(f));

        expect(disputeFiles.length).toBeGreaterThan(2);
        const withEmail = disputeFiles.filter((f) =>
            /sendEmailNotification|canSendEmail|new Resend/.test(code(f)));
        expect(withEmail).toEqual([]);
    });

    it('and it really does notify BOTH parties, so the new copy is true for each', () => {
        // Vacuity guard the other way: replacing a false claim with a second
        // false claim would pass every assertion above.
        //
        // Counted per party rather than matched once. `toMatch(/title:
        // "Dispute Resolved"/)` passed while one of the two notifications had
        // been renamed away — a membership test cannot tell "both parties are
        // told" from "one is", and both banners make the promise.
        // Counted over the whole file, not a slice of it. Splitting on the
        // function name looked tidier and took the text after its FIRST
        // mention — a log string, not the declaration — so the window missed
        // the notifications entirely. "Dispute Resolved" occurs only on the
        // resolve path, so it needs no window.
        const src = code(RESOLVER);

        expect(src).toContain('userId: d.initiatorId');
        expect(src).toContain('userId: d.respondentId');
        expect((src.match(/title: "Dispute Resolved"/g) ?? [])).toHaveLength(2);
        expect(src).toMatch(/SMS/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#312 — the two pages nothing can reach', () => {
    /**
     * Asserts the DEFECT. Failing here means somebody wired one of them up,
     * which is the moment to revisit the email promise on /verify-status.
     */
    const PAGES = ['/verify-status', '/verify-id'];

    it('both are declared in the route manifest TWICE — protected, and shared-domain', () => {
        // Counted, not merely present. A membership test could not tell one
        // declaration from two, so removing either list's entry left it
        // passing — which is the whole point being made here: these pages are
        // configured twice over and reachable zero times.
        const manifest = code('src/lib/route-manifest.ts');
        for (const p of PAGES) {
            const declarations = manifest.split(`"${p}"`).length - 1;
            expect({ p, declarations }).toEqual({ p, declarations: 2 });
        }
    });

    it('AND NOTHING LINKS, REDIRECTS OR PUSHES TO EITHER', () => {
        const referrers = sourceFiles()
            .filter((f) => f !== 'src/lib/route-manifest.ts')
            .filter((f) => PAGES.some((p) => code(f).includes(p)))
            // The pages' own directories are not referrers to themselves.
            .filter((f) => !f.startsWith('src/app/verify-'));

        expect(referrers).toEqual([]);
    });

    it('and /verify-status still promises an email nothing sends', () => {
        // Recorded, not corrected — see the header. The claim and its
        // emptiness are pinned together so neither is fixed without the other
        // being noticed.
        expect(code('src/app/verify-status/page.tsx')).toMatch(/receive an email once your verification/i);

        const senders = sourceFiles().filter((f) =>
            /verification is complete|verificationComplete/i.test(code(f))
            && /sendEmailNotification/.test(code(f)));
        expect(senders).toEqual([]);
    });
});
