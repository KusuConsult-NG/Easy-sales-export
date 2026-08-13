/**
 * @jest-environment node
 */

/**
 * The one broadcast audience whose recipients come from the caller was the one
 * with no bound and no validation.
 *
 * /api/admin/broadcast/send is otherwise carefully built: it batches in
 * hundreds, checks every address against BOUNCED_EMAILS before sending, writes
 * a BROADCAST_LOGS record naming who sent what to how many, and does the work
 * in the background so a large send does not hit the proxy timeout.
 *
 * Every audience is derived from stored records — cooperative members, academy
 * users, sellers — except one:
 *
 *     if (filters?.audience === "csv_upload") {
 *         const uniqueEmails = Array.from(new Set(filters.csvEmails.map(e => e.toLowerCase().trim())));
 *         const recipients = uniqueEmails.map(email => ({ uid: email, email, ... }));
 *
 * That list is request body. Any string became a recipient and the array could
 * be any length. So an outbound mail path from this business's sending domain
 * accepted an unbounded list of unvalidated addresses — while BOUNCED_EMAILS
 * exists precisely because sender reputation matters here, and every malformed
 * address sent to is a bounce against it.
 *
 * The other audiences are deliberately NOT capped. A broadcast to every
 * cooperative member should reach every cooperative member; the platform's own
 * size is not a thing to guard against. What is bounded is what a caller can
 * post.
 *
 * TWO MORE ON THE SAME ROUTE
 * --------------------------
 * No rate limit, on a route that sends mail from the business's domain and
 * could be called as fast as requests could be issued.
 *
 * No bound on `subject` or `body`. Both are written into a BROADCAST_LOGS
 * document and sent to every recipient, and a document over the row limit fails
 * the write after the caller has been told the send is under way.
 *
 * NOT FIXED HERE
 * --------------
 * The guard is isAdmin(), which accepts ten roles — support, moderator and all
 * six module admins can send a message to the entire user base. That is the
 * divergence recorded in admin-route-authority.test.ts, where the matrix
 * expresses a narrower intent than the routes enforce, and narrowing it is a
 * product decision rather than a repair. Noted here because this route is where
 * its blast radius is largest.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isPlausibleEmail, MAX_CSV_RECIPIENTS } from '@/lib/broadcast-logic';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

const route = source('src/app/api/admin/broadcast/send/route.ts');
const logic = source('src/lib/broadcast-logic.ts');

describe('an uploaded address list is checked', () => {
    it('accepts ordinary addresses', () => {
        // Vacuity guard first: a validator that refuses everything passes every
        // rejection assertion below and silently empties every CSV send.
        for (const good of [
            'a@b.co',
            'first.last@example.com',
            'user+tag@sub.domain.example.org',
            "o'brien@example.com",
            'UPPER@EXAMPLE.COM',
        ]) {
            expect(`${good}: ${isPlausibleEmail(good)}`).toBe(`${good}: true`);
        }
    });

    it('rejects what a spreadsheet column actually contains', () => {
        // A header row, a name column, an empty cell, a stray comma.
        for (const bad of ['', 'Email', 'Jane Doe', 'jane at example.com', '@example.com', 'jane@', 'jane@example', 'a b@c.com']) {
            expect(`${bad}: ${isPlausibleEmail(bad)}`).toBe(`${bad}: false`);
        }
    });

    it('is applied on the CSV path', () => {
        expect(logic).toContain('normalised.filter(isPlausibleEmail)');
    });

    it('refuses a send where nothing was valid', () => {
        // Rather than reporting a successful broadcast to zero people.
        expect(logic).toContain('were valid email addresses');
    });

    it('says how many it dropped', () => {
        // Silent truncation presented as success is the defect this audit has
        // found most often.
        expect(logic).toContain('dropped ${rejected} malformed address(es)');
    });
});

describe('an uploaded list has a ceiling', () => {
    it('is bounded', () => {
        expect(logic).toContain('filters.csvEmails.length > MAX_CSV_RECIPIENTS');
    });

    it('the ceiling is well above a real list', () => {
        // Vacuity guard: a cap of ten satisfies the assertion above and breaks
        // the feature.
        expect(MAX_CSV_RECIPIENTS).toBeGreaterThanOrEqual(1000);
    });

    it('the refusal says what to do instead', () => {
        expect(logic).toContain('Split the list and send in batches');
    });

    it('the database-derived audiences are NOT capped', () => {
        // The distinction that matters. A broadcast to every cooperative member
        // must still reach every cooperative member.
        const csvBlock = logic.slice(
            logic.indexOf('DEDICATED CSV UPLOAD PATH'),
            logic.indexOf('DEDICATED CSV UPLOAD PATH') + 2500
        );

        expect(csvBlock).toContain('MAX_CSV_RECIPIENTS');
        // The cap appears only inside the CSV branch.
        expect(logic.split('MAX_CSV_RECIPIENTS').length - 1).toBeLessThanOrEqual(4);
    });
});

describe('the route is throttled and bounded', () => {
    it('checks a limit', () => {
        expect(route).toContain('broadcastLimiter.check(session.user.id)');
    });

    it('keys on the account, not the address', () => {
        expect(route).not.toContain('clientIp');
    });

    it('the limit is checked before recipients are collected', () => {
        // Ordering: a limiter consulted after the audience is resolved has
        // already paid for the expensive part.
        const limitAt = route.indexOf('broadcastLimiter.check');
        const collectAt = route.indexOf('getCleanBroadcastList(filters)');

        expect(limitAt).toBeGreaterThan(-1);
        expect(collectAt).toBeGreaterThan(limitAt);
    });

    it('bounds the subject and the body', () => {
        expect(route).toContain('String(subject).length > MAX_SUBJECT_CHARS');
        expect(route).toContain('String(body).length > MAX_BODY_CHARS');
    });

    it('the bounds are generous enough to write a newsletter', () => {
        // Vacuity guard.
        const subject = Number(route.match(/MAX_SUBJECT_CHARS = (\d+)/)?.[1]);
        const body = Number(route.match(/MAX_BODY_CHARS = ([\d_]+)/)?.[1]?.replace(/_/g, ''));

        expect(subject).toBeGreaterThanOrEqual(100);
        expect(body).toBeGreaterThanOrEqual(10_000);
    });

    it('refuses before writing the log or starting the send', () => {
        const bodyCheckAt = route.indexOf('MAX_BODY_CHARS');
        const logAt = route.indexOf('COLLECTIONS.BROADCAST_LOGS');

        expect(bodyCheckAt).toBeGreaterThan(-1);
        expect(logAt).toBeGreaterThan(bodyCheckAt);
    });
});

describe('what was already right', () => {
    it('every address is checked against the bounce list', () => {
        expect(route).toContain('COLLECTIONS.BOUNCED_EMAILS');
    });

    it('the send is batched', () => {
        expect(route).toContain('const BATCH = 100');
    });

    it('a record is written naming who sent what', () => {
        // Better than the approval routes, which recorded nothing at all.
        expect(route).toContain('sentBy: session.user.id');
        expect(route).toContain('totalRecipients: allRecipients.length');
    });

    it('a send to nobody is reported as a failure', () => {
        expect(route).toContain('No recipients matched the selected filters');
    });
});

describe('recorded, not fixed', () => {
    it('ten roles can broadcast to the whole platform', () => {
        // The isAdmin/matrix divergence from admin-route-authority.test.ts,
        // noted here because this is where its blast radius is largest: support
        // and every module admin can email the entire user base.
        expect(route).toContain('isAdmin(session.user.roles)');
    });
});
