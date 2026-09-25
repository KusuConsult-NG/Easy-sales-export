/**
 * @jest-environment jsdom
 */

/**
 *   #924 RejectionModal MAKES AN ADMIN JUSTIFY A DECISION. ONE OF THE FIVE DOORS
 *   IT FEEDS PUT THAT JUSTIFICATION WHERE NOTHING READS IT.
 *
 *   components/admin/RejectionModal is rendered by five admin screens and had
 *   never been named by a test. It will not enable Confirm until the reason is at
 *   least TEN characters, and its default banner says the reason "will be
 *   communicated to the applicant".
 *
 * ── THE FIVE DOORS, TRACED ──────────────────────────────────────────────────
 *
 *       export   rejectExportApplicationAction   stored · EMAILED, quoted
 *       wave     rejectWaveApplicationAction     stored · EMAILED
 *       coop     /api/admin/cooperative/reject-member
 *                                                stored · EMAILED
 *       mkt      /api/admin/marketplace/reject-seller
 *                                                stored · EMAILED · SHOWN
 *       mkt      /api/admin/marketplace/suspend-seller
 *                                                stored ×2 · nothing
 *
 *   Four of five keep the promise. The fifth writes `suspensionReason` on the
 *   verification row AND on `serviceRegistrations.marketplace.suspensionReason`,
 *   sends no email, and raises no notification.
 *
 *   MEASURED BEFORE CALLING IT DEAD: `grep -rn suspensionReason src` found four
 *   occurrences and every one was a WRITE — this route twice, and
 *   bulk-user-operations twice (which also deletes it on unsuspend). Not one
 *   reader in the tree.
 *
 * ── AND THE SELLER HAD A SLOT FOR IT ALL ALONG ──────────────────────────────
 *
 *   marketplace/onboarding/pending routes `rejected` AND `suspended` to
 *   /marketplace/onboarding, in one line, together. That screen renders an amber
 *   banner with a paragraph for the explanation — reading `rejectionReason`.
 *
 *   So a suspended seller, whose shop has stopped working, was sent to a banner
 *   headed "Your verification requires updates" with nothing underneath it. The
 *   ten characters the admin was compelled to write were in the row, one field
 *   away, unread.
 *
 *   THE REJECTION PATH IS COMPLETE BY CONTRAST — stored, emailed, shown — and
 *   that asymmetry on one screen is what makes this an omission rather than a
 *   decision somebody made.
 *
 * ── WHAT IS RECORDED AND NOT FIXED ──────────────────────────────────────────
 *
 *   NO SUSPENSION EMAIL EXISTS. lib/email-notifications has
 *   sendSellerRejectionEmail, sendMembershipRejectionEmail,
 *   sendWithdrawalRejectedEmail and sendExportProductRejectionEmail, and no
 *   suspension counterpart. Writing one is composing a new message to sellers in
 *   the platform's voice, which is the owner's to word. The gap is named and
 *   counted here; the seller can at least now read the reason on their own screen.
 *
 *   THE SERVER MINIMUM IS ONE CHARACTER, NOT TEN. Both review schemas require
 *   only `!!reason`, and the two API routes only `!reason`. The ten-character
 *   floor is the browser's alone. Left as it is: every door is admin-only behind
 *   a permission check, so the caller who would bypass it is the same person the
 *   floor is advising, and refusing a short-but-adequate reason on the server
 *   would strand an admin mid-decision. Pinned so the asymmetry is visible.
 *
 *   TWO REVIEW SCHEMAS ARE BYTE-IDENTICAL. WaveApplicationReviewSchema and
 *   ExportOnboardingReviewSchema have the same three fields and the same refine,
 *   differing only in name. They agree today, which is when a ledger is worth
 *   more than a rewrite: folding them means one module's schema importing
 *   another's, and #912 already recorded what happened when a schema dragged the
 *   database in behind it.
 *
 *   `jest` is the GLOBAL here, per #392.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';
import { WaveApplicationReviewSchema, ExportOnboardingReviewSchema } from '@/lib/schemas';

jest.mock('@/app/actions/marketplace', () => ({
    submitQuoteRequestAction: jest.fn(async () => ({ success: true, data: { message: 'ok' } })),
}));

jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('@/components/ui/Modal', () => ({
    __esModule: true,
    default: ({ isOpen, title, children }: any) =>
        isOpen ? <div><h2>{title}</h2>{children}</div> : null,
}));

import RejectionModal from '@/components/admin/RejectionModal';
import { LocalVideoPreview } from '@/components/ui/LocalVideoPreview';
import ShipmentFields from '@/components/marketplace/ShipmentFields';
import QuoteRequestModal from '@/components/modals/QuoteRequestModal';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.2 });

const SUSPEND = 'src/app/api/admin/marketplace/suspend-seller/route.ts';
const REJECT_SELLER = 'src/app/api/admin/marketplace/reject-seller/route.ts';
const ONBOARDING = 'src/app/marketplace/onboarding/MarketplaceOnboardingClient.tsx';
const PENDING = 'src/app/marketplace/onboarding/pending/page.tsx';

const onConfirm = jest.fn(async (_reason: string) => undefined);
const onClose = jest.fn();

beforeEach(() => {
    jest.clearAllMocks();
});

function open(props: Record<string, unknown> = {}) {
    return render(
        <RejectionModal isOpen onClose={onClose} onConfirm={onConfirm} {...props} />,
    );
}

const type = (text: string) =>
    fireEvent.change(screen.getByPlaceholderText(/Enter the reason/), { target: { value: text } });

const confirm = () => screen.getByRole('button', { name: /Confirm Rejection/ });

// ─────────────────────────────────────────────────────────────────────────────
describe('#924 — RejectionModal makes the admin say why', () => {
    it('THE CONTROL: a long enough reason is accepted, trimmed', async () => {
        open();
        type('  Documents do not match the business name  ');
        fireEvent.click(confirm());

        await waitFor(() =>
            expect(onConfirm).toHaveBeenCalledWith('Documents do not match the business name'));
    });

    it('refuses to enable Confirm below ten characters', () => {
        open();
        type('too short');

        expect(confirm()).toHaveProperty('disabled', true);
    });

    it('and counts TRIMMED length, so spaces are not a reason', () => {
        open();
        type('          ');

        expect(confirm()).toHaveProperty('disabled', true);
    });

    it('says what is wrong only once the admin has started typing', () => {
        //   An empty box is not an error yet — it is a box.
        open();
        expect(screen.getByText('Minimum 10 characters')).toBeTruthy();

        type('short');
        expect(screen.getByText('Minimum 10 characters required')).toBeTruthy();
    });

    it('caps the reason and shows the count', () => {
        open();
        const box = screen.getByPlaceholderText(/Enter the reason/);

        expect(box.getAttribute('maxLength')).toBe('500');
        expect(screen.getByText('0/500')).toBeTruthy();
    });

    it('will not close or submit while it is processing', () => {
        //   The confirm button is found by position, not by name: while
        //   processing it reads "Processing..." rather than "Confirm Rejection",
        //   which is itself part of the behaviour.
        open({ isProcessing: true });
        type('Documents do not match the business name');
        const [cancel, action] = screen.getAllByRole('button');

        expect(action.textContent).toContain('Processing');
        expect(action).toHaveProperty('disabled', true);
        fireEvent.click(cancel);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('clears the box on the way out, so the next rejection starts empty', () => {
        //   The same modal serves every row in an admin list. A reason left
        //   over from the previous applicant is the worst possible default.
        open();
        type('Documents do not match the business name');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.getByPlaceholderText(/Enter the reason/)).toHaveProperty('value', '');
    });

    it('and its default banner promises the applicant will be told', () => {
        //   The promise the rest of this file is about.
        open();

        expect(screen.getByText(/This will be communicated to the applicant/)).toBeTruthy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#924 — the suspension reason now reaches the seller', () => {
    it('the suspend route writes it, twice, and sends nothing', () => {
        const src = code(SUSPEND);

        expect(src).toContain('suspensionReason: reason');
        expect(src).toContain('"serviceRegistrations.marketplace.suspensionReason": reason');
        //   RECORDED: no email, no notification. The reject route beside it sends
        //   one, which is how this reads as an omission.
        expect(src).not.toMatch(/send\w*Email|createNotification/);
        expect(code(REJECT_SELLER)).toContain('sendSellerRejectionEmail');
    });

    it('a suspended seller is routed to the screen that shows the reason', () => {
        //   One line handles both verdicts, which is why the slot was already
        //   there and only the field name was wrong.
        expect(code(PENDING))
            .toContain('applicationStatus === "rejected" || applicationStatus === "suspended"');
        expect(code(PENDING)).toContain('router.replace("/marketplace/onboarding")');
    });

    it('THE FIX: that screen reads suspensionReason as well as rejectionReason', () => {
        const src = code(ONBOARDING);

        expect(src).toContain('if (v.suspensionReason) setRejectionReason(v.suspensionReason)');
        expect(src).toContain('else if (v.rejectionReason) setRejectionReason(v.rejectionReason)');
    });

    it('and the suspension wins when a row carries both', () => {
        //   A rejected seller who reapplies and is later suspended has both
        //   fields. The suspension is the newer verdict, so it is the one to show —
        //   asserted on the ORDER, which is the whole content of the decision.
        const src = code(ONBOARDING);

        expect(src.indexOf('v.suspensionReason'))
            .toBeLessThan(src.indexOf('else if (v.rejectionReason)'));
    });

    it('THE LEDGER — writes of suspensionReason with no reader', () => {
        //   Was four writes, zero readers. One reader now, and this counts the
        //   readers rather than the writes, because a fifth write is fine and a
        //   return to zero readers is the defect.
        const readers: string[] = [];
        const writers: string[] = [];

        const walk = (dir: string): void => {
            for (const entry of readdirSync(join(ROOT, dir))) {
                const rel = `${dir}/${entry}`;
                if (statSync(join(ROOT, rel)).isDirectory()) {
                    if (!['node_modules', '.next', '__tests__'].includes(entry)) walk(rel);
                    continue;
                }
                if (!/\.tsx?$/.test(entry)) continue;
                const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'),
                    { label: rel, minRetainedRatio: 0 });
                if (!src.includes('suspensionReason')) continue;

                //   STRING LITERALS BLANKED BEFORE LOOKING FOR A READ. The
                //   suspend route writes the field by its DOTTED PATH —
                //   `"serviceRegistrations.marketplace.suspensionReason": reason`
                //   — and a naive `/\.suspensionReason/` finds the dot inside
                //   that quoted key and reports the writer as a reader. The first
                //   version of this sweep did exactly that, and would have
                //   reported the defect as already fixed.
                const withoutStrings = src.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');

                if (/suspensionReason"?\]?\s*:|suspensionReason\s*=/.test(src)) writers.push(rel);
                if (/\.suspensionReason\b/.test(withoutStrings)) readers.push(rel);
            }
        };
        walk('src');

        expect(readers).toEqual([ONBOARDING]);
        expect(ledgerVerdict(1 - readers.length, 0)).toBe(LEDGER_HELD);
        //   The control: the sweep can tell the two apart, and the writers are
        //   still there.
        expect(writers.length).toBeGreaterThanOrEqual(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#924 — what the server asks of a reason, which is less', () => {
    it('both review schemas need a reason to reject, and only that', () => {
        for (const schema of [WaveApplicationReviewSchema, ExportOnboardingReviewSchema]) {
            expect(schema.safeParse({ applicationId: 'a1', status: 'rejected' }).success).toBe(false);
            //   ONE character passes. The browser's floor is ten.
            expect(schema.safeParse({ applicationId: 'a1', status: 'rejected', reason: 'x' }).success)
                .toBe(true);
            //   And approving needs no reason at all.
            expect(schema.safeParse({ applicationId: 'a1', status: 'approved' }).success).toBe(true);
        }
    });

    it('and the two API doors ask the same one question', () => {
        for (const rel of [SUSPEND, REJECT_SELLER]) {
            expect(code(rel)).toMatch(/!\w+Id \|\| !reason/);
        }
    });

    it('THE LEDGER — review schemas that are copies of each other', () => {
        //   Byte-identical but for the name. They AGREE, which is when recording
        //   beats rewriting: folding them makes one module's schema import
        //   another's, and #912 recorded what a schema dragging its neighbour in
        //   costs. A third copy is the thing to catch.
        const schemas = code('src/lib/schemas.ts');
        const shape = (name: string) => {
            const at = schemas.indexOf(`export const ${name} = z.object({`);
            expect(at).toBeGreaterThan(-1);
            return schemas.slice(at, schemas.indexOf('});', at))
                .replace(name, 'SCHEMA');
        };

        expect(shape('WaveApplicationReviewSchema')).toBe(shape('ExportOnboardingReviewSchema'));
        expect(ledgerVerdict(2, 2)).toBe(LEDGER_HELD);
    });

    it('POSITIVE CONTROL: the shape reader is reading a real schema', () => {
        const schemas = code('src/lib/schemas.ts');

        expect(schemas).toContain('Reason is required when rejecting');
        expect(schemas).toContain('status: z.enum(["approved", "rejected"])');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#924 — the three in this batch with nothing to fix', () => {
    /**
     * Recorded rather than left silent. Each was read for a specific suspicion,
     * each answered it, and the answer is the thing worth keeping.
     */
    /*
     *   jsdom HAS NO URL.createObjectURL AT ALL — not a stub, not a throwing
     *   stub, absent. So these are installed rather than spied on, and the first
     *   draft of this section captured the "real" one into a variable (undefined),
     *   restored it in a finally, and left the NEXT test with
     *   "URL.createObjectURL is not a function". The fourth harness gap this
     *   audit has hit in as many batches; installed for the whole block instead.
     */
    const created: string[] = [];
    const revoked: string[] = [];

    beforeEach(() => {
        created.length = 0;
        revoked.length = 0;
        let next = 0;
        URL.createObjectURL = ((): string => {
            const url = `blob:mock/${next++}`;
            created.push(url);
            return url;
        }) as typeof URL.createObjectURL;
        URL.revokeObjectURL = ((url: string) => { revoked.push(url); }) as typeof URL.revokeObjectURL;
    });

    it('LocalVideoPreview mints ONE object URL per file and revokes it', () => {
        //   THE SUSPICION: the sibling image preview calls createObjectURL inline
        //   in render, so every keystroke elsewhere on the form leaks another URL
        //   for the same file — on a 200MB clip. This component exists to not do
        //   that, and this is the assertion that it does not.
        const file = new File(['clip'], 'yam.mp4', { type: 'video/mp4' });
        const view = render(<LocalVideoPreview file={file} />);

        expect(created).toHaveLength(1);
        expect(revoked).toHaveLength(0);

        //   A re-render with the SAME file must not mint a second.
        view.rerender(<LocalVideoPreview file={file} />);
        expect(created).toHaveLength(1);

        view.unmount();
        expect(revoked).toEqual(created);
    });

    it('and a NEW file replaces the URL rather than adding one', () => {
        const view = render(
            <LocalVideoPreview file={new File(['a'], 'a.mp4', { type: 'video/mp4' })} />);
        view.rerender(
            <LocalVideoPreview file={new File(['b'], 'b.mp4', { type: 'video/mp4' })} />);

        expect(created).toHaveLength(2);
        //   The first is released as the second is made — one live URL at a time.
        expect(revoked).toEqual([created[0]]);
    });

    it('and does not autoplay, which is a decision its header states', () => {
        const file = new File(['clip'], 'yam.mp4', { type: 'video/mp4' });
        const { container } = render(<LocalVideoPreview file={file} />);
        const video = container.querySelector('video');

        expect(video?.hasAttribute('autoplay')).toBe(false);
        expect(video?.getAttribute('preload')).toBe('metadata');
        expect(video?.hasAttribute('controls')).toBe(true);
    });

    it('ShipmentFields offers both shapes, and self-delivery asks for a person', () => {
        //   THE SUSPICION: a sixth Nigerian-phone rule on the courier number. There
        //   is none, and that is RIGHT rather than an omission — "a phone number
        //   the buyer can call" may be a landline or a bus-park office, which
        //   isNigerianMobile would refuse. lib/shipment-record asks only that it is
        //   not empty.
        const noop = () => undefined;
        const { container } = render(
            <ShipmentFields
                method="self_delivery" onMethod={noop}
                carrier="" onCarrier={noop}
                trackingNumber="" onTrackingNumber={noop}
                courierName="Musa" onCourierName={noop}
                courierPhone="08031234567" onCourierPhone={noop}
                accent="orange"
            />);

        const phone = container.querySelector('input[type="tel"]') as HTMLInputElement;
        expect(phone).toBeTruthy();
        expect(phone.value).toBe('08031234567');
        expect(phone.hasAttribute('pattern')).toBe(false);
    });

    it('and the courier rule really is only "not empty"', () => {
        const record = code('src/lib/shipment-record.ts');

        expect(record).toContain('A phone number the buyer can call.');
        expect(record).not.toContain('isNigerianMobile');
    });

    it('QuoteRequestModal renders nothing when closed', () => {
        const item = { id: 'p1', title: 'Yam', sellerId: 's1', unit: 'kg' };
        const { container } = render(
            <QuoteRequestModal isOpen={false} item={item} onClose={() => undefined} />);

        expect(container.firstChild).toBeNull();
    });

    it('and its list caller MOUNTS it conditionally, which is why state cannot carry over', () => {
        //   THE SUSPICION: `if (!isOpen) return null` sits after the hooks, so a
        //   parent that keeps this mounted would show the previous product's
        //   quantity, notes and OFFERED PRICE against the next one.
        //
        //   Measured on both callers. ProductDetailClient is one product per page,
        //   so there is no next one. ExportOpportunitiesClient is a LIST — and it
        //   renders `{selectedWindow && <QuoteRequestModal …>}` while onClose sets
        //   selectedWindow to null, so the component unmounts and remounts fresh
        //   per window. Clean, and pinned HERE rather than in the modal, because
        //   the guarantee lives at the call site.
        const list = code('src/app/export/(app)/opportunities/ExportOpportunitiesClient.tsx');

        expect(list).toContain('{selectedWindow && (');
        expect(list).toContain('setSelectedWindow(null)');
    });

    it('and the offered price stays absent when the buyer types nothing', () => {
        //   0 and "no offer" are different things, and #873's note says the action
        //   treats them as such. Asserted at source: the expression is the guarantee.
        expect(code('src/components/modals/QuoteRequestModal.tsx'))
            .toContain("offeredPrice: offeredPrice.trim() === \"\" ? undefined : Number(offeredPrice)");
    });
});
