/**
 * Every place this platform opens a Paystack checkout, and the payment type it
 * mints there.
 *
 *   #727 THE SCAN LIVES IN ONE FILE BECAUSE THE FINDING WAS A SECOND COPY.
 *
 *   #695's suite guarantees that every checkout the platform mints has a door
 *   that fulfils it — the finding behind "the buyer pays, nothing is fulfilled,
 *   and the screen says it worked". It measured that across a HAND-WRITTEN LIST
 *   of eight files, under a comment claiming the control proved the list
 *   complete. The control proved the other direction: that no LISTED file had
 *   gone stale. Nothing asked whether the list covered every checkout.
 *
 *   Three did not call the shared initializer at all — they POST to
 *   /transaction/initialize with their own fetch — so the scan could not see
 *   them however carefully it read the files it knew about. Pointing one of
 *   them at a type no processor owns left that suite green.
 *
 *   THE FIX WAS A SWEEP, AND THE FIRST DRAFT WROTE THE SWEEP TWICE — once in
 *   #695's suite and once in #727's. Mutation testing caught it immediately:
 *   breaking one copy left the other suite green, which is this audit's single
 *   most frequent defect reproduced inside its own repair. Two copies of one
 *   fact, with the stale one deciding.
 *
 *   So it lives here, and both suites import it. Breaking the sweep now breaks
 *   every assertion that rests on it, which is the only arrangement under which
 *   those assertions mean anything.
 *
 * ── WHAT IT DOES AND DOES NOT INFER ─────────────────────────────────────────
 *
 *   #678's discarded instrument is the warning: an instrument that infers
 *   MEANING from the shape of source code is a second implementation of the
 *   application, and it drifts.
 *
 *   This infers nothing. It looks for two literal strings — the initializer's
 *   name and Paystack's endpoint path — and reads `type:` out of the call that
 *   contains them. A checkout it cannot read the type of shows up as a file
 *   with no minted type, which the callers assert against rather than ignore.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

/** The shared server-side initializer. */
export const INIT_HELPER = 'initializePaystackPayment(';

/** Paystack's own endpoint, for the checkouts that POST to it directly. */
export const INIT_ENDPOINT = '/transaction/initialize';

/**
 * The initializer itself and the client helper module.
 *
 * Not checkouts: one IS the shared initializer (so it necessarily contains the
 * endpoint), and the other is the browser-side hook module.
 */
export const NOT_A_CHECKOUT: readonly string[] = [
    'src/lib/paystack-server.ts',
    'src/lib/paystack.ts',
];

/**
 * Every .ts/.tsx file of the APPLICATION under src/.
 *
 * `__tests__` and `lib/testing` are excluded because they are scaffolding, not
 * checkouts — and this module lives in the second of them, so without that
 * exclusion the scan finds itself: it necessarily contains both literal
 * strings it searches for.
 */
export function sourceFiles(): string[] {
    const out: string[] = [];
    const SCAFFOLDING = join(ROOT, 'src', 'lib', 'testing');
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
                if (full === SCAFFOLDING) continue;
                walk(full);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name)) continue;
            out.push(relative(ROOT, full).split(sep).join('/'));
        }
    };
    walk(join(ROOT, 'src'));
    return out.sort();
}

/** One file's source with comments stripped, so a mention in prose never counts. */
export function checkoutSource(rel: string): string {
    return stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });
}

/** Every file that opens a Paystack checkout, by either route. */
export function checkoutFiles(): string[] {
    return sourceFiles().filter((rel) => {
        if (NOT_A_CHECKOUT.includes(rel)) return false;
        const src = checkoutSource(rel);
        return src.includes(INIT_HELPER) || src.includes(INIT_ENDPOINT);
    });
}

/**
 * The span of one call, from its opening paren to the paren that closes it.
 *
 * Scoped to the CALL by matching parens rather than to a fixed window: a window
 * long enough to reach one call's metadata object is long enough to reach the
 * next call's, and which call mints which type is the whole question.
 */
export function callSpan(src: string, openParenAt: number): string {
    let depth = 0;
    for (let i = openParenAt; i < src.length; i++) {
        const c = src[i];
        if (c === '(') depth++;
        else if (c === ')') {
            depth--;
            if (depth === 0) return src.slice(openParenAt, i + 1);
        }
    }
    return src.slice(openParenAt);
}

/** Every payment type minted by a checkout, with the file that mints it. */
export function mintedTypes(): Array<{ where: string; type: string }> {
    const found: Array<{ where: string; type: string }> = [];

    for (const rel of checkoutFiles()) {
        const src = checkoutSource(rel);

        //   FORM ONE — the shared initializer. Span the call itself.
        let at = src.indexOf(INIT_HELPER);
        while (at !== -1) {
            const span = callSpan(src, at + INIT_HELPER.length - 1);
            const m = span.match(/\btype:\s*["'`]([a-z_]+)["'`]/);
            if (m) found.push({ where: rel, type: m[1] });
            at = src.indexOf(INIT_HELPER, at + INIT_HELPER.length);
        }

        /*
         *   FORM TWO — a raw POST to the endpoint.
         *
         *   The endpoint string sits inside the `fetch(` call, so the span is
         *   taken from the fetch's own opening paren: the body object holding
         *   `metadata: { type: ... }` is an argument to it. Walking back to the
         *   nearest preceding `fetch(` rather than assuming a line offset,
         *   because these three calls are formatted three different ways.
         */
        at = src.indexOf(INIT_ENDPOINT);
        while (at !== -1) {
            const fetchAt = src.lastIndexOf('fetch(', at);
            if (fetchAt !== -1) {
                const span = callSpan(src, fetchAt + 'fetch'.length);
                const m = span.match(/\btype:\s*["'`]([a-z_]+)["'`]/);
                if (m) found.push({ where: rel, type: m[1] });
            }
            at = src.indexOf(INIT_ENDPOINT, at + INIT_ENDPOINT.length);
        }
    }
    return found;
}
