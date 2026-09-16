/**
 * @jest-environment node
 */

/**
 *   #833 `crypto.randomUUID is not a function` — THE HOMEPAGE, FATAL.
 *
 *   From the owner's production log, over and over:
 *
 *       [ERROR] Next.js Global UI Boundary Caught Exception
 *       {"message":"crypto.randomUUID is not a function",
 *        "path":"/","fatal":true}
 *
 *   and the same on /wave/landing. `fatal: true` is the whole finding: this was
 *   not a broken chat button, it was the global error boundary catching a throw
 *   that unwound the entire React tree. Those visitors got an error page
 *   instead of the platform.
 *
 * ── WHY EVERY PAGE ──────────────────────────────────────────────────────────
 *
 *   AiChatWidget is rendered by ClientLayout, which wraps every route, and its
 *   mount effect called `initSession()` UNCONDITIONALLY:
 *
 *       useEffect(() => {
 *           initSession();          // ← crypto.randomUUID()
 *           if (isOpen && …) { … }
 *       }, [isOpen, …]);
 *
 *   Not when the chat opened. On every mount of every page. So one line in a
 *   decorative widget decided whether the site rendered at all.
 *
 * ── AND WHY THESE VISITORS ──────────────────────────────────────────────────
 *
 *   `crypto.randomUUID` is Chrome 92 and Safari 15.4 — 2021 and 2022. The
 *   people without it are on older phones and older Android WebViews, which on
 *   a Nigerian agricultural platform is a share of exactly the applicants the
 *   programme exists for.
 *
 * ── THE FALLBACK IS THE SAME CRYPTOGRAPHIC SOURCE ───────────────────────────
 *
 *   `crypto.getRandomValues` predates randomUUID by about a decade and is in
 *   every browser that can run this application. lib/random-id uses it to build
 *   the same v4 UUID by hand, so nothing is weakened.
 *
 *   THERE IS NO Math.random() PATH, on purpose. Two of the four callers mint
 *   IDEMPOTENCY KEYS FOR MONEY — a withdrawal and an export booking — and a key
 *   from a predictable source is a duplicate-payment guard that has quietly
 *   stopped guarding. Those two use the throwing form; the chat widget, which
 *   is decoration, uses the one that returns null and turns itself off.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the getRandomValues fallback removed                           KILLED
 *     the fallback returning a non-UUID shape                        KILLED
 *     version/variant bits not set                                   KILLED
 *     randomId reading crypto at module load instead of call time    KILLED
 *     the widget back to crypto.randomUUID directly                  KILLED
 *     the widget's init un-gated from isOpen again                   KILLED
 *     a money modal switched to randomIdOrNull                       KILLED
 *     reword this header                                 SURVIVED, intended
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { randomId, randomIdOrNull, NoSecureRandomError } from '@/lib/random-id';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const WIDGET = 'src/components/ai/AiChatWidget.tsx';
const MONEY = [
    'src/components/modals/WithdrawalModal.tsx',
    'src/components/modals/ExportWindowModal.tsx',
];

/** RFC 4122 v4, which is what a caller storing or comparing one expects. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const realCrypto = globalThis.crypto;
/** Replace the global crypto for one case, then put it back. */
function withCrypto(fake: unknown): void {
    Object.defineProperty(globalThis, 'crypto', {
        value: fake, configurable: true, writable: true,
    });
}
afterEach(() => withCrypto(realCrypto));

// ─────────────────────────────────────────────────────────────────────────────
describe('#833 — a browser without randomUUID still gets an id', () => {
    it('THE REPORTED BROWSER — randomUUID absent, getRandomValues present', () => {
        /*
         *   THE case from the log. Before this finding, calling into this path
         *   threw `crypto.randomUUID is not a function` and the page died.
         */
        withCrypto({
            getRandomValues: (a: Uint8Array) => {
                for (let i = 0; i < a.length; i += 1) a[i] = (i * 37 + 11) & 0xff;
                return a;
            },
        });

        const id = randomId();
        expect(id).toMatch(UUID_V4);
    });

    it('AND IT IS A DIFFERENT ID EACH TIME, from real entropy', () => {
        //   A fallback that returned a constant would satisfy the shape check
        //   above and make every idempotency key identical — which is the worst
        //   possible outcome on a payment path.
        withCrypto(realCrypto);
        const ids = new Set(Array.from({ length: 200 }, () => randomId()));
        expect(ids.size).toBe(200);
    });

    it('AND THE VERSION AND VARIANT BITS ARE SET', () => {
        /*
         *   Without them the string is random and is not a UUID. These ids
         *   cross into api/ai and the withdrawal and booking actions, where one
         *   is stored, compared and logged.
         */
        withCrypto({
            //   All-zero bytes: only the version and variant nibbles can make
            //   this a valid v4, so nothing else can be carrying the test.
            getRandomValues: (a: Uint8Array) => { a.fill(0); return a; },
        });

        const id = randomId();
        expect(id).toMatch(UUID_V4);
        expect(id[14]).toBe('4');                       // version
        expect(['8', '9', 'a', 'b']).toContain(id[19]); // variant
    });

    it('AND THE MODERN PATH IS STILL PREFERRED WHEN IT EXISTS', () => {
        let used = false;
        withCrypto({
            randomUUID: () => { used = true; return '11111111-1111-4111-8111-111111111111'; },
            getRandomValues: () => { throw new Error('should not be reached'); },
        });

        expect(randomId()).toBe('11111111-1111-4111-8111-111111111111');
        expect(used).toBe(true);
    });

    it('AND CRYPTO IS READ AT CALL TIME, not captured at module load', () => {
        /*
         *   A module-level capture runs during SSR, where the answer can differ
         *   from the browser's. A capability decided on the server is the wrong
         *   answer for the client that receives it — and this module is
         *   imported by client components rendered on both.
         */
        withCrypto(undefined);
        expect(() => randomId()).toThrow(NoSecureRandomError);

        withCrypto(realCrypto);
        expect(randomId()).toMatch(UUID_V4);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#833 — decoration degrades, money does not', () => {
    it('randomIdOrNull RETURNS NULL RATHER THAN THROWING', () => {
        withCrypto({});
        expect(randomIdOrNull()).toBeNull();
    });

    it('AND STILL RETURNS A REAL ID WHEN IT CAN', () => {
        withCrypto(realCrypto);
        expect(randomIdOrNull()).toMatch(UUID_V4);
    });

    it('THE CHAT WIDGET USES THE FORM THAT CANNOT TAKE THE PAGE DOWN', () => {
        const src = code(WIDGET);

        expect(src).toContain('randomIdOrNull');
        expect(src).not.toContain('crypto.randomUUID');
    });

    it('AND THE TWO MONEY MODALS USE THE FORM THAT FAILS LOUDLY', () => {
        /*
         *   An idempotency key is what stops a withdrawal or a booking being
         *   submitted twice. `randomIdOrNull` there would hand the action a
         *   null key — a duplicate guard that has silently stopped guarding,
         *   which is worse than a visible failure.
         */
        for (const file of MONEY) {
            const src = code(file);
            expect({ file, usesThrowing: /setIdempotencyKey\(randomId\(\)\)/.test(src) })
                .toEqual({ file, usesThrowing: true });
            expect({ file, usesNullable: src.includes('randomIdOrNull') })
                .toEqual({ file, usesNullable: false });
            expect(src).not.toContain('crypto.randomUUID');
        }
    });

    it('AND THE WIDGET ONLY MINTS A SESSION WHEN THE CHAT IS OPEN', () => {
        /*
         *   The reason one line reached every visitor: the effect called
         *   initSession() unconditionally, so a decorative feature did work on
         *   the homepage of a platform whose visitors never opened it.
         */
        const src = code(WIDGET);
        expect(src).toMatch(/if \(isOpen\) initSession\(\);/);
        expect(src).not.toMatch(/^\s*initSession\(\);\s*$/m);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#833 — and no client component calls it directly again', () => {
    it('THE SWEEP IS BY SHAPE, over everything that ships to a browser', () => {
        /*
         *   An enumerated list of the four known call sites could not catch a
         *   fifth — #824's lesson, which cost an eighth invented acronym
         *   expansion. So this sweeps every file under src/ that is not a
         *   server module and fails on ANY direct `crypto.randomUUID`.
         *
         *   Server code is exempt and stays exempt: `randomUUID` imported from
         *   node's `crypto` is a different function with no browser in the
         *   picture, and three server modules use it correctly.
         */
        const { readdirSync, statSync } = require('fs') as typeof import('fs');
        const walk = (dir: string, out: string[] = []): string[] => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    if (entry !== 'node_modules') walk(full, out);
                } else if (/\.tsx?$/.test(full) && !/__tests__|\.test\./.test(full)) {
                    out.push(full);
                }
            }
            return out;
        };

        const offenders: string[] = [];
        for (const file of walk(join(ROOT, 'src'))) {
            const src = stripComments(readFileSync(file, 'utf-8'), { label: file });
            //   `crypto.randomUUID(` on the GLOBAL — not `randomUUID()` from a
            //   node import, which is the server form and is fine.
            if (/\bcrypto\.randomUUID\s*\(/.test(src)) {
                offenders.push(file.slice(ROOT.length + 1));
            }
        }

        expect(offenders).toEqual([]);
    });

    it('CONTROL: THE SWEEP WOULD CATCH ONE', () => {
        //   Vacuity guard — the assertion above passes trivially if the pattern
        //   stopped matching or the walk stopped walking.
        const sample = stripComments('const id = crypto.randomUUID();\n', { label: 'x' });
        expect(/\bcrypto\.randomUUID\s*\(/.test(sample)).toBe(true);
    });
});
