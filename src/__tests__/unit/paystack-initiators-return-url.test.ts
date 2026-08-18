/**
 * @jest-environment node
 */

/**
 * A payment initiator that does not hand back its authorization URL has taken
 * the user nowhere.
 *
 * initializePaystackPayment returns { authorizationUrl, accessCode, reference }.
 * The URL is the whole point: the caller redirects the browser to it. An action
 * that obtains one and then returns `data: null` has created a Paystack
 * transaction that nobody can pay.
 *
 * BOTH EXPORT INITIATORS DID EXACTLY THAT
 * ---------------------------------------
 *   initializeExportOrderPaymentAction    the export buyer cart
 *   initializeInvestmentPaymentAction     the export window invest button
 *
 * Both destructured `{ authorizationUrl, reference }`, used neither, and
 * returned `data: null` on success. Their callers both read
 * `result.data?.authorizationUrl` and show "No authorization URL", so neither
 * export checkout could complete a single payment.
 *
 * The cart page made it worse: it called clearCart() BEFORE checking for the
 * URL, so the buyer's basket was emptied on the way to the error — and since
 * the action returned null on every success, that was not a rare path but the
 * only one.
 *
 * Every other initiator on the platform — marketplace, cooperative, farm
 * nation, academy — already returned it. These two were the outliers.
 *
 * This suite scans rather than listing: the rule is "if you obtained a URL,
 * return it", and a new initiator that forgets should fail here rather than in
 * production.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOTS = ['src/app/actions', 'src/app/api'];

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(entry) && !full.includes('__tests__')) out.push(full);
    }
    return out;
}

function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/**
 * Every FUNCTION that obtains an authorization URL, and whether it hands it on.
 *
 * Split per function, not per file. Both export initiators live in
 * export-payment.ts, so a file-level scan is satisfied by either one of them
 * using the URL — which is exactly the masking that let the second sit broken
 * beside the first. The first version of this scan had that bug and passed
 * against a reintroduced `data: null`.
 */
function initiators(): Array<{ where: string; usesUrl: boolean }> {
    const found: Array<{ where: string; usesUrl: boolean }> = [];

    for (const root of ROOTS) {
        for (const file of walk(join(process.cwd(), root))) {
            const src = stripComments(readFileSync(file, 'utf-8'));
            if (!src.includes('initializePaystackPayment(')) continue;

            const rel = relative(process.cwd(), file);

            // Function boundaries: every top-level `function` declaration.
            const bounds: number[] = [];
            const re = /^(export )?(async )?function \w+/gm;
            let m: RegExpExecArray | null;
            while ((m = re.exec(src)) !== null) bounds.push(m.index);
            bounds.push(src.length);

            for (let i = 0; i < bounds.length - 1; i++) {
                const body = src.slice(bounds[i], bounds[i + 1]);
                const call = body.indexOf('initializePaystackPayment(');
                if (call === -1) continue;

                const name = /function (\w+)/.exec(body)?.[1] ?? 'anonymous';

                // Destructured: the URL must be named again after the call.
                const destructured = /const\s*\{[^}]*authorizationUrl[^}]*\}\s*=\s*await\s+initializePaystackPayment\(/.test(body);
                if (destructured) {
                    const after = body.slice(body.indexOf('initializePaystackPayment(') + 26);
                    found.push({ where: `${rel}::${name}`, usesUrl: after.includes('authorizationUrl') });
                    continue;
                }

                // Whole-object: it must return the object it got.
                const whole = /const\s+(\w+)\s*=\s*await\s+initializePaystackPayment\(/.exec(body);
                if (whole) {
                    found.push({ where: `${rel}::${name}`, usesUrl: body.includes(`data: ${whole[1]}`) });
                }
            }
        }
    }

    return found;
}

describe('every Paystack initiator', () => {
    const found = initiators();

    it('is found at all — the scan is not vacuous', () => {
        // A scanner returning [] passes every assertion below and proves nothing.
        expect(found.length).toBeGreaterThanOrEqual(5);
    });

    it('hands its authorization URL back to the caller', () => {
        const silent = found.filter((f) => !f.usesUrl).map((f) => f.where);

        expect(silent).toEqual([]);
    });

    it('including both export initiators, which did not', () => {
        // THE test. Named explicitly so the two that were broken stay covered
        // even if the scan above is ever loosened.
        const payment = stripComments(
            readFileSync(join(process.cwd(), 'src/app/actions/export-payment.ts'), 'utf-8')
        );

        const returns = payment.match(/data: \{ authorizationUrl, reference \}/g) || [];
        expect(returns.length).toBe(2);
    });
});

describe('the export cart', () => {
    const cart = readFileSync(
        join(process.cwd(), 'src/app/export/buyer/cart/page.tsx'), 'utf-8'
    );

    it('clears the basket only once there is somewhere to go', () => {
        const check = cart.indexOf('if (result.data?.authorizationUrl)');
        const clear = cart.indexOf('clearCart();');

        expect(check).toBeGreaterThan(-1);
        expect(clear).toBeGreaterThan(check);
    });

    it('and still clears it before the redirect', () => {
        // Leaving a paid-for basket behind would be the opposite mistake.
        const clear = cart.indexOf('clearCart();');
        const redirect = cart.indexOf('window.location.href = result.data.authorizationUrl');

        expect(redirect).toBeGreaterThan(clear);
    });

    it('and still reports the failure it used to report', () => {
        expect(cart).toContain('Failed to initialize payment: No authorization URL');
    });
});
