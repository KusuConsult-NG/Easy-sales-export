/**
 * @jest-environment node
 */

/**
 * The notification settings screen configures a channel that does not exist.
 *
 * /admin/settings/notifications rendered five toggles under:
 *
 *     "Configure which events trigger admin email notifications"
 *
 *   New User Registration   Email when a new user signs up
 *   Export Requests         Email for new export applications
 *   Loan Applications       Email for new loan requests
 *   System Alerts           Critical system notifications
 *   Weekly Digest           Summary of platform activity
 *
 * Four of the five default to ON.
 *
 * NOTHING READS THEM, AND THE EMAILS DO NOT EXIST
 * -----------------------------------------------
 * None of newUserEmail, exportRequestEmail, loanApplicationEmail, systemAlerts
 * or weeklyDigest appears anywhere outside this screen and the route that
 * stores them. That alone would make it the same defect as the security panel
 * in #170.
 *
 * It goes further. There is no admin-directed email sender in the platform at
 * all. Every function in lib/email-notifications.ts writes to a USER —
 * membership approval, withdrawal confirmation, seller approval, password
 * reset — and nothing sends to an operator address. The single occurrence of
 * info@easysalesexport.com in the codebase is a contact link inside a message
 * to a user.
 *
 * So an operator opening this page is told that new-user, export-request and
 * loan-application emails are reaching them, and that "System Alerts —
 * Critical system notifications" is on. None of those messages has ever been
 * sent. Somebody relying on system alerts to hear about a problem has been
 * told they are covered.
 *
 * WHY THE COPY AND NOT THE WIRING
 * -------------------------------
 * Same reasoning as #167 and #170. Building an admin notification channel —
 * deciding recipients, digest scheduling, what counts as a critical alert — is
 * a feature, not a correction. What can be fixed immediately is the platform
 * telling its operator something untrue. The preferences are still stored and
 * are what a notifier should read when one is built.
 *
 * These tests are written to FAIL when somebody wires it up, at which point
 * they should be replaced by tests of the notifier.
 *
 * ONE THING THAT WAS FIXED
 * ------------------------
 * The POST wrote `{ ...settings }` — the caller's object into the config
 * document wholesale, any key, any type, any size. The blast radius is small
 * while nothing reads the document, which is exactly why it was worth
 * constraining now: whoever builds the notifier will read from here and should
 * find only what this screen puts in it.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

const KEYS = ['newUserEmail', 'exportRequestEmail', 'loanApplicationEmail', 'systemAlerts', 'weeklyDigest'];

const page = source('src/app/admin/settings/notifications/page.tsx');
const route = source('src/app/api/admin/settings/notifications/route.ts');

describe('the state of admin notifications, recorded', () => {
    it('no setting is read outside this screen', () => {
        for (const key of KEYS) {
            const readers = execSync(`grep -rln '${key}' src --include='*.ts' --include='*.tsx' || true`, {
                encoding: 'utf-8',
                cwd: process.cwd(),
            })
                .split('\n')
                .filter(Boolean)
                .filter((f) => !f.includes('__tests__'))
                .filter((f) => !f.includes('settings/notifications'));

            expect(`${key}: ${readers.join(', ')}`).toBe(`${key}: `);
        }
    });

    it('there is no admin-directed email sender at all', () => {
        // The stronger half of the finding. Every sender takes a user address.
        const senders = source('src/lib/email-notifications.ts');
        const exported = [...senders.matchAll(/export async function (send\w+)/g)].map((m) => m[1]);

        expect(exported.length).toBeGreaterThan(10);
        for (const fn of exported) {
            expect(`${fn} is admin-directed: ${/admin|operator|internal/i.test(fn)}`)
                .toBe(`${fn} is admin-directed: false`);
        }
    });

    it('the toggles still default to mostly on', () => {
        // Which is why the copy mattered: the page asserted an active state
        // rather than an off one.
        expect(route).toContain('newUserEmail: true');
        expect(route).toContain('systemAlerts: true');
    });
});

describe('the screen says what is true', () => {
    it('no longer claims the toggles configure anything', () => {
        expect(page).not.toContain('Configure which events trigger admin email notifications');
    });

    it('says the preferences are recorded and not acted on', () => {
        // Asserted on the correction rather than the absence of the old claim,
        // because the comment explaining the fix quotes the old wording — the
        // trap that has caught six assertions in this audit.
        expect(page).toContain('Not yet active');
        expect(page).toContain('admin notification email');
    });

    it('still offers the toggles', () => {
        // Vacuity guard: deleting the screen satisfies every assertion above
        // and throws away a stored preference the notifier will want.
        for (const key of KEYS) {
            expect(page).toContain(key);
        }
        expect(page).toContain('saveSettings');
    });

    it('matches how the security screen was corrected', () => {
        // Same defect, same treatment, so an operator meets one convention.
        expect(source('src/app/admin/settings/security/page.tsx')).toContain('Not yet enforced');
    });
});

describe('the config document holds only what the screen owns', () => {
    it('the caller object is not spread into it', () => {
        expect(route).not.toContain('...settings,');
        expect(route).toContain('NOTIFICATION_KEYS');
    });

    it('values are coerced to booleans', () => {
        expect(route).toContain('patch[key] = Boolean(settings[key])');
    });

    it('the allow-list is the same list the GET defaults use', () => {
        // Two lists would drift, and a document holding keys the screen does
        // not render is how a preference becomes unreachable.
        const list = route.slice(route.indexOf('const NOTIFICATION_KEYS'), route.indexOf('] as const'));

        for (const key of KEYS) {
            expect(list).toContain(`"${key}"`);
        }
    });

    it('refuses a body with no known key', () => {
        // Rather than reporting a successful save that wrote nothing.
        expect(route).toContain('No known notification settings were provided');
    });

    it('records who changed them', () => {
        expect(route).toContain('updatedBy: session.user.id');
    });

    it('still saves a real change', () => {
        // Vacuity guard: an allow-list that matches nothing refuses every save.
        expect(route).toContain('if (key in settings) patch[key] = Boolean');
    });
});
