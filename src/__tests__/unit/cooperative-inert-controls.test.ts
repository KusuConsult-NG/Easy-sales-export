/**
 * @jest-environment node
 */

/**
 * Buttons that promised an action and performed none.
 *
 * Five controls across the cooperative pages — four on the member side, one on
 * the admin side — had no onClick, no type="submit" and no disabled state. They
 * rendered, they hovered, and clicking them did nothing at all:
 *
 *   onboarding/pending-payment  "Upload Receipt", under the promise "Upload
 *                               your payment receipt to speed up verification".
 *                               There is no receipt upload anywhere in the
 *                               platform: no endpoint, no handler, no field on
 *                               the membership. A member waiting on their
 *                               payment was told the one thing they could do to
 *                               help, given a button for it, and clicking it
 *                               achieved nothing.
 *
 *   directory                   "Filter", beside a search box that already
 *                               filters and works.
 *
 *   history                     "Export" — no CSV, no download — and a
 *                               date-filter button with no date state behind it.
 *
 *   admin/contributions         "Export Report", the same thing on the admin
 *                               side: an admin clicked it and no report was
 *                               exported.
 *
 * Building a receipt upload or a CSV export is a feature. Removing a control
 * that lies about one is the fix, and the pending-payment copy now says what
 * actually happens instead.
 *
 * The scan is structural rather than a list, and covers both halves of the
 * module, so a sixth inert button added later cannot slip in behind these.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// Both halves of the module: the member pages and the admin ones. The admin
// contributions screen carried the same inert "Export Report" button.
const ROOTS = ['src/app/cooperatives', 'src/app/admin/cooperatives'];

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx$/.test(entry)) out.push(full);
    }
    return out;
}

/** Strip comments so a button described in prose is not mistaken for one. */
function strip(src: string): string {
    return src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
}

interface InertButton { file: string; line: number; label: string }

function inertButtons(): InertButton[] {
    const found: InertButton[] = [];

    for (const file of ROOTS.flatMap((r) => walk(join(process.cwd(), r)))) {
        const src = strip(readFileSync(file, 'utf-8'));

        for (const m of src.matchAll(/<button\b((?:[^>]|\n)*?)>/g)) {
            const attrs = m[1];
            // A control is inert only if it does nothing AND cannot do anything:
            // no handler, not a form submit, and not deliberately disabled.
            if (/onClick|type="submit"|disabled/.test(attrs)) continue;

            const tail = src.slice(m.index! + m[0].length);
            const label = tail.split('</button>')[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

            found.push({
                file: relative(process.cwd(), file),
                line: src.slice(0, m.index).split('\n').length,
                label: label.slice(0, 60),
            });
        }
    }

    return found;
}

describe('the cooperative pages, member and admin', () => {
    it('offer no button that does nothing when clicked', () => {
        // THE test.
        const inert = inertButtons();

        if (inert.length) {
            throw new Error(
                '\n\n⚠️  Inert button(s) on the cooperative pages — they render and '
                + 'hover and do nothing:\n\n'
                + inert.map((b) => `  ${b.file}:${b.line}  "${b.label}"`).join('\n')
                + '\n\nGive it a handler, mark it disabled with a reason, or remove it.\n',
            );
        }

        expect(inert).toEqual([]);
    });

    it('and the scan really can find one, so it is not vacuous', () => {
        // A scanner that matches nothing passes the assertion above and proves
        // nothing. Fed a button with no handler, it must report it.
        const src = `
            <button className="x">
                <span>Do Nothing</span>
            </button>
        `;
        const matches = [...strip(src).matchAll(/<button\b((?:[^>]|\n)*?)>/g)]
            .filter((m) => !/onClick|type="submit"|disabled/.test(m[1]));

        expect(matches).toHaveLength(1);
    });

    it('and does not flag a button that is wired up', () => {
        const src = `
            <button onClick={handleThing} className="x">Do A Thing</button>
            <button type="submit" className="y">Submit</button>
            <button disabled className="z">Not Yet</button>
        `;
        const matches = [...strip(src).matchAll(/<button\b((?:[^>]|\n)*?)>/g)]
            .filter((m) => !/onClick|type="submit"|disabled/.test(m[1]));

        expect(matches).toHaveLength(0);
    });
});

describe('the pending-payment page', () => {
    const page = readFileSync(
        join(process.cwd(), 'src/app/cooperatives/onboarding/pending-payment/page.tsx'),
        'utf-8',
    );

    it('no longer promises a receipt upload that does not exist', () => {
        expect(strip(page)).not.toContain('Upload Receipt');
        expect(strip(page)).not.toContain('Upload your payment receipt to speed up verification');
    });

    it('and says what actually happens instead', () => {
        expect(page).toContain('Verification Is Automatic');
        expect(page).toContain('confirmed with Paystack directly');
    });

    it('which is true — no receipt upload exists anywhere', () => {
        // Vacuity guard: if the platform did accept receipts, the fix would be
        // to wire the button up rather than to remove it.
        const uploads = walk(join(process.cwd(), 'src/app/api'))
            .filter((f) => /receipt/i.test(f));

        expect(uploads).toEqual([]);
    });
});
