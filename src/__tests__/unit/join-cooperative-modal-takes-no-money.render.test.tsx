/**
 * @jest-environment jsdom
 */

/**
 *   #380 A FOURTH JOIN DOOR THAT CREDITED SAVINGS NOBODY HAD PAID.
 *
 *        JoinCooperativeModal held a server function declared inside this
 *        client module and wired to its form. It hand-rolled a complete join:
 *        it took the form's "Initial Contribution (Optional)" number, wrote it
 *        as the new membership's opening balance, and incremented it into the
 *        cooperative's totalSavings. No payment was taken anywhere.
 *
 *        joinCooperativeAction — the sibling door — was fixed for EXACTLY this
 *        in an earlier pass and now refuses any non-zero contribution, with the
 *        reason recorded on it: the cooperative loan limit is a multiple of
 *        savings balance, so an invented balance was borrowing power too. The
 *        fix landed on one of two doors. #83/#297's shape.
 *
 *        Three more faults came with it: the membership went to the legacy
 *        nested path under a cooperative document, which no reader in this
 *        codebase consults; it bypassed the registration fee that
 *        /cooperatives/onboarding takes; and it required a "Monthly Savings
 *        Target" that nothing anywhere reads.
 *
 *   WHAT THIS SUITE IS FOR
 *   ----------------------
 *   The modal is not mounted by anything today, and "no screen calls it" is the
 *   reason four faults sat in it unexamined. So the assertions here are about
 *   what the file CAN do, not about what a caller happens to do: it must hold
 *   no server function, reach no database, and offer no control that moves
 *   money. Plus the premises the decision rests on, so that a change to any of
 *   them fails here rather than silently reopening the door.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
// NOT from '@jest/globals': that import shadows the global `expect`, and the
// shadowed one carries none of jest-dom's matchers, so toBeInTheDocument and
// toHaveAttribute fail to typecheck. The other render suites use the ambient
// globals for the same reason.
import { stripComments } from '@/lib/testing/strip-comments';

import JoinCooperativeModal, { COOPERATIVE_JOIN_PATH } from '@/components/modals/JoinCooperativeModal';

const ROOT = process.cwd();
const MODAL = 'src/components/modals/JoinCooperativeModal.tsx';
const SIBLING = 'src/app/actions/cooperative/_coop_registration.ts';

const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

function renderModal() {
    return render(
        <JoinCooperativeModal isOpen onClose={() => {}} cooperativeName="Easy Sales Cooperative" />,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#380 — the modal can no longer move money, because it can no longer act', () => {
    it('HOLDS NO SERVER FUNCTION AT ALL', () => {
        // Scanned with comments removed, deliberately: the file's own header
        // describes what used to be here, and a raw-text assertion would trip on
        // the explanation rather than on the code. That trap has cost this audit
        // several gates.
        const src = code(MODAL);

        expect(src).not.toMatch(/["']use server["']/);
        expect(src).not.toMatch(/useActionState/);
    });

    it('and reaches no database, session or action', () => {
        const src = code(MODAL);

        expect(src).not.toMatch(/supabase-db/);
        expect(src).not.toMatch(/session-guard/);
        expect(src).not.toMatch(/setDoc|updateDoc|\bincrement\(/);
        expect(src).not.toMatch(/COLLECTIONS\./);
    });

    it('the whole file is now imports and markup — vacuity guard on the three above', () => {
        // Without this, deleting the component would satisfy every negative
        // assertion in this describe block.
        const src = code(MODAL);

        expect(src).toContain('export default function JoinCooperativeModal');
        expect(src.length).toBeGreaterThan(500);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#380 — and it offers no control that takes or credits a figure', () => {
    it('RENDERS NO CONTRIBUTION FIELD', () => {
        renderModal();

        expect(document.querySelector('input[name="initialContribution"]')).toBeNull();
        expect(screen.queryByText(/Initial Contribution/i)).toBeNull();
    });

    it('and no monthly savings target, which nothing reads', () => {
        renderModal();

        expect(document.querySelector('input[name="monthlyTarget"]')).toBeNull();
        expect(screen.queryByText(/Monthly Savings Target/i)).toBeNull();
    });

    it('and submits no form anywhere', () => {
        const { container } = renderModal();

        expect(container.querySelector('form')).toBeNull();
        expect(container.querySelector('input')).toBeNull();
    });

    it('it still shows the member which cooperative this is — vacuity guard', () => {
        renderModal();

        expect(screen.getByText('Easy Sales Cooperative')).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#380 — it points at the join flow the product actually has', () => {
    it('THE PRIMARY CONTROL LINKS TO THE PAID ONBOARDING PATH', () => {
        renderModal();

        const link = screen.getByRole('link', { name: /Continue to Membership/i });
        expect(link).toHaveAttribute('href', '/cooperatives/onboarding');
    });

    it('and the exported constant is the same path, not a second copy of it', () => {
        expect(COOPERATIVE_JOIN_PATH).toBe('/cooperatives/onboarding');
    });

    it('the link carries no query the join flow would ignore', () => {
        // /cooperatives/onboarding reads exactly one search param, `token`, for
        // an invite. A cooperativeId appended here would be a value nothing
        // reads — the class of defect this file was fixed for.
        renderModal();

        const href = screen.getByRole('link', { name: /Continue to Membership/i })
            .getAttribute('href') ?? '';

        expect(href).not.toContain('?');
    });

    it('every other "Join Cooperative" control in the product points at the same path', () => {
        // The premise for pointing here rather than building a second door: the
        // widget, the id-card page, the loans and fixed-savings empty states all
        // already send a prospective member to onboarding.
        const hits = execSync(
            `grep -rn "cooperatives/onboarding" src/components src/app --include=*.tsx || true`,
            { encoding: 'utf-8', cwd: ROOT },
        ).split('\n').filter((l) => l.trim());

        expect(hits.length).toBeGreaterThanOrEqual(4);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#380 — the premises the decision rests on', () => {
    it('THE SIBLING DOOR STILL REFUSES AN UNPAID CONTRIBUTION', () => {
        // If this ever stops being true, the reasoning for retiring this one
        // ("the rule already exists on the door that has it") is gone.
        const src = code(SIBLING);
        const door = src.slice(src.indexOf('export async function joinCooperativeAction'));
        const body = door.slice(0, door.indexOf('const batch = db.batch()'));

        expect(body.length).toBeGreaterThan(200);          // vacuity guard on the slice
        expect(body).toMatch(/initialContribution\s*!==\s*0/);
        expect(body).toContain('return {');
    });

    it('and creates the membership PENDING, not active', () => {
        const src = code(SIBLING);
        const door = src.slice(src.indexOf('export async function joinCooperativeAction'));

        expect(door.slice(0, door.indexOf('batch.commit'))).toMatch(/membershipStatus:\s*["']pending["']/);
    });

    it('nothing anywhere reads monthlyTarget', () => {
        // The reason the required input is gone rather than wired. Writers are
        // allowed; a reader appearing means the field has become real and the
        // form question can be asked again.
        const lines = execSync('grep -rn "monthlyTarget" src || true', { encoding: 'utf-8', cwd: ROOT })
            .split('\n')
            .filter((l) => l.trim())
            .filter((l) => !l.includes('__tests__'))
            .filter((l) => !l.includes('src/lib/types/'));

        expect(lines.length).toBeGreaterThan(0);            // vacuity guard on the grep

        const readers = lines.filter((line) => {
            const rel = line.split(':')[0];
            const lineno = Number(line.split(':')[1]);
            if (!rel || !Number.isFinite(lineno)) return false;

            const text = code(rel).split('\n')[lineno - 1] ?? '';
            if (!text.includes('monthlyTarget')) return false;

            // A write states the field as a key or a property assignment; a read
            // takes its value off something.
            return /\.monthlyTarget\b|\[["']monthlyTarget["']\]/.test(text);
        });

        expect(readers).toEqual([]);
    });

    it('and nothing writes into the legacy nested members path any more', () => {
        // The modal was the only code in the tree that touched
        // cooperatives/{id}/members/{uid}. Every membership reader uses the root
        // cooperative_members collection, so a row written there was invisible.
        const nested = execSync(
            `grep -rn "COLLECTIONS.COOPERATIVES, " src || true`,
            { encoding: 'utf-8', cwd: ROOT },
        ).split('\n').filter((l) => l.trim()).filter((l) => !l.includes('__tests__'));

        expect(nested).toEqual([]);
    });
});
