/**
 * @jest-environment node
 */

/**
 *   #934 THE LAST TEN FILES NO TEST HAD NAMED — nine correct, one shipping a
 *        spinner where a redirect belonged.
 *
 *   This closes the reach ledger. Nine of the ten were opened, measured and
 *   found right, and each verdict is written down rather than left implicit —
 *   the treatment #918 gave the services registry, for the reason it gave: a
 *   clean verdict nobody recorded gets re-derived by the next person.
 *
 *     loans/success                  its "you'll receive an email once a decision
 *                                    has been made" is HONOURED — #688 routed all
 *                                    seven loan-decision doors through
 *                                    lib/loan-decision-notice. Measured, because
 *                                    #929 had just found the same sentence
 *                                    unbacked on the WAVE revision path.
 *     cooperatives/onboarding/success  retired to a redirect by #384.
 *     dashboard/reviews/new            retired by #384, and it carries the
 *                                    orderId through so a bookmark still lands
 *                                    on the right order's review form.
 *     cooperatives/page              server redirect to /cooperatives/landing.
 *     dashboard/orders               server redirect to the buyer's orders.
 *     marketplace/sell/orders        server redirect to the seller's orders.
 *     export/buyer/orders            reads on the server and a failed read is
 *                                    NOT rendered as an empty list (#313's rule).
 *     farm-nation/(member)/offers     the server half: seedOrNull, and the action
 *                                    takes no user id so there is nothing to pass
 *                                    wrongly.
 *     data/polling-units             a shard per state, every file present, and
 *                                    server-only as its header claims.
 *
 * ── AND THE ONE THAT WAS NOT ────────────────────────────────────────────────
 *
 *   /marketplace/buyer forwarded to /marketplace/buyer/products from a
 *   `useEffect`, behind a spinner. Four pages on this platform do nothing but
 *   forward; the other three are one line of `redirect()` on the server. This one
 *   shipped a client component that mounted, painted, ran an effect and then
 *   navigated — so the buyer waits on JavaScript before anything moves, sees a
 *   spinner that means nothing, and with JavaScript unavailable or still loading
 *   the spinner is the whole screen and the redirect never happens.
 *
 *   A MEASUREMENT THAT CORRECTED ITSELF, recorded because the near miss is
 *   instructive. The polling-unit shards looked short by one state: lib/locations
 *   has an "Abuja" key with no shard behind it. It is in STATE_COORDINATES — a
 *   geocoding alias carrying FCT's exact latitude and longitude — and NOT in
 *   NIGERIAN_LOCATIONS, which is what STATES and every state dropdown derive
 *   from. So nothing offers "Abuja" to anybody and the shards are complete. The
 *   cross-check below is against the map that feeds the dropdown, which is the
 *   one a missing shard would strand somebody through.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { NIGERIAN_LOCATIONS } from '@/lib/locations';
import { POLLING_UNIT_SHARDS } from '@/data/polling-units';

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(src(rel), { label: rel, minRetainedRatio: 0 });

// ─────────────────────────────────────────────────────────────────────────────
describe('#934 — four pages that only forward, and now all four do it on the server', () => {
    const FORWARDERS: { rel: string; to: string }[] = [
        { rel: 'src/app/marketplace/buyer/page.tsx', to: '/marketplace/buyer/products' },
        { rel: 'src/app/dashboard/orders/page.tsx', to: '/marketplace/buyer/orders' },
        { rel: 'src/app/marketplace/sell/orders/page.tsx', to: '/marketplace/seller/orders' },
        { rel: 'src/app/cooperatives/page.tsx', to: '/cooperatives/landing' },
    ];

    it('EVERY ONE OF THEM REDIRECTS ON THE SERVER, to the page it always meant', () => {
        for (const { rel, to } of FORWARDERS) {
            const page = code(rel);

            expect({ rel, imports: page.includes('import { redirect } from "next/navigation"')
                || page.includes("import { redirect } from 'next/navigation'") })
                .toEqual({ rel, imports: true });
            expect({ rel, to, sends: page.includes(`redirect("${to}")`) || page.includes(`redirect('${to}')`) })
                .toEqual({ rel, to, sends: true });
        }
    });

    it('AND NONE OF THEM IS A CLIENT COMPONENT WITH AN EFFECT', () => {
        /*
         *   The defect, stated as the property that was false. A forwarding page
         *   that needs JavaScript shows a spinner to anybody whose bundle has not
         *   arrived — and to a crawler, a loading animation is the whole page.
         */
        for (const { rel } of FORWARDERS) {
            const page = code(rel);

            expect({ rel, client: page.includes('"use client"') }).toEqual({ rel, client: false });
            expect({ rel, effect: page.includes('useEffect') }).toEqual({ rel, effect: false });
            expect({ rel, replace: page.includes('router.replace') }).toEqual({ rel, replace: false });
            expect({ rel, spinner: /animate-spin/.test(page) }).toEqual({ rel, spinner: false });
        }
    });

    it('POSITIVE CONTROL: these are still four separate, tiny files', () => {
        //   Three `not`-shaped assertions above, all of which pass on an empty
        //   string.
        for (const { rel } of FORWARDERS) {
            expect({ rel, exists: existsSync(join(ROOT, rel)) }).toEqual({ rel, exists: true });
            expect({ rel, short: code(rel).split('\n').filter((l) => l.trim()).length < 12 })
                .toEqual({ rel, short: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#934 — the two retired screens still land somebody somewhere useful', () => {
    it('THE RETIRED REVIEW FORM CARRIES THE ORDER THROUGH', () => {
        //   A bookmark naming an order should reach that order's review form, not
        //   a list the buyer has to search.
        const page = code('src/app/dashboard/reviews/new/page.tsx');

        expect(page).toContain('searchParams');
        expect(page).toContain('/marketplace/buyer/orders/${orderId}/review');
        expect(page).toContain('"/marketplace/buyer/orders"');
    });

    it('AND THE RETIRED COOPERATIVE SUCCESS PAGE GOES TO THE DASHBOARD', () => {
        expect(code('src/app/cooperatives/onboarding/success/page.tsx'))
            .toContain('redirect("/cooperatives/dashboard")');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#934 — two server halves that refuse to fake an answer', () => {
    it('THE EXPORT BUYER ORDERS PAGE DOES NOT RENDER A FAILED READ AS "no orders"', () => {
        //   #313's rule, and the reason this file was worth opening: an empty list
        //   after a failed read is the lie that matters on a screen somebody opens
        //   BECAUSE they have just paid.
        const page = code('src/app/export/buyer/orders/page.tsx');

        expect(page).toContain('.catch(');
        expect(page).toMatch(/readMyExportOrders/);
    });

    it('AND THE FARM NATION OFFERS PAGE PASSES NO USER ID it could pass wrongly', () => {
        const page = code('src/app/farm-nation/(member)/offers/page.tsx');

        expect(page).toContain('seedOrNull(');
        expect(page).toContain('getMyLandOffersAction()');
        expect(page).toContain('export const dynamic = "force-dynamic"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#934 — the polling-unit shards, cross-checked against the dropdown', () => {
    it('ONE SHARD FOR EVERY STATE THE PLATFORM OFFERS', () => {
        /*
         *   The check a missing shard would need. NIGERIAN_LOCATIONS is what
         *   STATES — and so every state dropdown — is derived from, so a state
         *   present there with no shard behind it is a WAVE applicant who can
         *   never pick a polling unit.
         *
         *   NOT STATE_COORDINATES, which carries an "Abuja" alias at FCT's exact
         *   coordinates. That alias made the shards look short by one until the
         *   two maps were told apart.
         */
        const offered = Object.keys(NIGERIAN_LOCATIONS).sort();
        const sharded = Object.keys(POLLING_UNIT_SHARDS).sort();

        expect(offered).toHaveLength(37);
        expect(sharded).toEqual(offered);
    });

    it('AND EVERY SHARD FILE IS ON DISK', () => {
        /*
         *   A key whose import target is missing throws at request time, on the
         *   one step of the WAVE application that needs it.
         *
         *   READ FROM THE SOURCE, not from `loader.toString()`. The first version
         *   did the latter and found nothing: Jest's transform rewrites a dynamic
         *   import, so the compiled function no longer contains the specifier. The
         *   file's text does.
         */
        const dir = 'src/data/polling-units';
        const files = new Set(readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.json')));
        const declared = [...src(`${dir}/index.ts`)
            .matchAll(/"([^"]+)":\s*\(\)\s*=>\s*import\("\.\/([^"]+)"\)/g)]
            .map((m) => ({ state: m[1], file: m[2] }));

        expect(declared).toHaveLength(Object.keys(POLLING_UNIT_SHARDS).length);
        expect(files.size).toBeGreaterThanOrEqual(37);

        for (const { state, file } of declared) {
            expect({ state, file, present: files.has(file) }).toEqual({ state, file, present: true });
        }
    });

    it('AND A SHARD REALLY LOADS — the control on all of the above', async () => {
        /*
         *   One of them, for real. Every assertion above reads text; this proves
         *   the mechanism those keys exist for actually resolves, and that the
         *   shape lib/polling-units expects — wards mapped to arrays of units — is
         *   what arrives.
         */
        const shard = await POLLING_UNIT_SHARDS['FCT']();
        const wards = Object.keys(shard.default);

        expect(wards.length).toBeGreaterThan(0);
        expect(Array.isArray(shard.default[wards[0]])).toBe(true);
        expect(typeof shard.default[wards[0]][0]).toBe('string');
    });

    it('AND NOTHING ON THE CLIENT IMPORTS FIVE MEGABYTES OF THEM', () => {
        /*
         *   Its header's claim: "SERVER ONLY. These shards total about five
         *   megabytes; lib/polling-units.ts loads one state at a time and no
         *   client component imports them." Measured, because that is a claim a
         *   single stray import turns into a bundle nobody notices.
         */
        const importers: string[] = [];
        (function walk(dir: string) {
            for (const entry of readdirSync(join(ROOT, dir))) {
                const rel = `${dir}/${entry}`;
                if (statSync(join(ROOT, rel)).isDirectory()) {
                    if (entry !== '__tests__') walk(rel);
                } else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) {
                    if (/from ["']@\/data\/polling-units["']/.test(src(rel))) importers.push(rel);
                }
            }
        })('src');

        expect(importers).toEqual(['src/lib/polling-units.ts']);
        expect(code('src/lib/polling-units.ts')).not.toContain('"use client"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#934 — and the loan success screen keeps a promise somebody else has to', () => {
    it('ITS EMAIL PROMISE IS BACKED BY THE DECISION PATHS', () => {
        /*
         *   "You'll receive an email notification once a decision has been made."
         *   #929 had just found the same shape of sentence unbacked on the WAVE
         *   revision path, so this was measured rather than believed: #688 moved
         *   the loan notice into lib/loan-decision-notice precisely because only
         *   two of seven doors told the member anything.
         */
        expect(code('src/app/loans/success/page.tsx'))
            .toContain("You'll receive an email notification once a decision has been made");

        const notice = code('src/lib/loan-decision-notice.ts');
        expect(notice.length).toBeGreaterThan(200);

        //   And the doors call it.
        const callers = ['src/app/actions/admin/_loans.ts'];
        for (const rel of callers) {
            expect({ rel, notifies: code(rel).includes('notifyLoanDecision(') })
                .toEqual({ rel, notifies: true });
        }
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   restore the client useEffect redirect on         "EVERY ONE OF THEM
 *     /marketplace/buyer (the defect)                REDIRECTS ON THE SERVER"
 *                                                    and "NONE OF THEM IS A
 *                                                    CLIENT COMPONENT"
 *   point a forwarder at a different page            "to the page it always
 *                                                    meant"
 *   drop the orderId from the retired review form    "CARRIES THE ORDER THROUGH"
 *   remove a state from POLLING_UNIT_SHARDS          "ONE SHARD FOR EVERY STATE"
 *   add a state to NIGERIAN_LOCATIONS with no shard  the same test
 *   rename a shard json without updating the map     "EVERY SHARD FILE IS ON
 *                                                    DISK"
 *   import the shard map from a client component     "NOTHING ON THE CLIENT
 *                                                    IMPORTS FIVE MEGABYTES"
 *   delete notifyLoanDecision from the admin door    "ITS EMAIL PROMISE IS
 *                                                    BACKED"
 */
