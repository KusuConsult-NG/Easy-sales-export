/**
 * @jest-environment node
 */

/**
 * Any authenticated user could write arbitrary rows into the audit log.
 *
 * /api/hub/telemetry takes a moduleId, an event name and a metadata object from
 * the request and writes all three straight into COLLECTIONS.AUDIT_LOGS:
 *
 *     await db.collection(COLLECTIONS.AUDIT_LOGS).add({
 *         userId: session.user.id,
 *         moduleId,                       // any string
 *         action: `telemetry_${event}`,   // any string
 *         metadata: metadata || {},       // any object, any size
 *         source: "telemetry_bridge"
 *     });
 *
 * with no rate limit and no validation.
 *
 * WHY THAT COLLECTION MATTERS
 * ---------------------------
 * It is the same one getAuditLogsAction reads, getAuditStatsAction counts by
 * action and reports the top ten of, and the CSV export in #150 pages through
 * up to twenty thousand rows. So one account could bury the record of what
 * everybody else did, in the one place that is supposed to survive that — and
 * make the export useless by volume without ever touching a permission.
 *
 * Nothing reads `source: "telemetry_bridge"`, so these rows are not separated
 * from real audit entries by any reader.
 *
 * THE TRIAGE THAT MISSED IT
 * -------------------------
 * contact-rate-limit.test.ts records an earlier pass over the unauthenticated
 * POST routes, and clears this one:
 *
 *     hub/telemetry   authenticated via auth(); missed by the first filter,
 *                     which looked only for requireSession
 *
 * That is correct, and it answers the question it was asked: is this reachable
 * without a session? It is not. Nobody asked the next question — what does an
 * authenticated caller get to write — and the answer was everything.
 *
 * The same shape as the broadcast history in #154, which sat triaged in the
 * auth baseline twice and was wrong both times because "is it public?" was the
 * only question put to it.
 *
 * WHAT CHANGED
 * ------------
 * A per-account rate limit; moduleId checked against the real identifier list;
 * the event name restricted to a short lowercase token, since it becomes part
 * of `action` and is what the statistics group by; and metadata bounded by
 * serialised size rather than by shape, because open-ended metadata is the
 * point of telemetry and the problem was never its structure.
 *
 * APP_IDENTIFIERS is now exported from role-app-mapping.ts, where the list
 * already existed as a local inside canAccessRoute. Writing a second copy here
 * is the duplication this audit keeps finding drifted apart.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_IDENTIFIERS } from '@/lib/role-app-mapping';
import { rateLimitConfig } from '@/lib/rate-limits.config';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

const route = source('src/app/api/hub/telemetry/route.ts');

describe('the audit write is throttled', () => {
    it('checks a limit before writing', () => {
        // Ordering: a limiter consulted after the row is written is decoration.
        const limitAt = route.indexOf('telemetryLimiter.check(session.user.id)');
        const writeAt = route.indexOf('COLLECTIONS.AUDIT_LOGS');

        expect(limitAt).toBeGreaterThan(-1);
        expect(writeAt).toBeGreaterThan(limitAt);
    });

    it('keys on the account, per #163', () => {
        expect(route).toContain('.check(session.user.id)');
        expect(route).not.toContain('clientIp');
    });

    it('is generous enough for machine traffic', () => {
        // Guard against fixing a flood by breaking the feature. This is a module
        // reporting real events, not a person clicking, so a burst is
        // legitimate.
        const perHour = rateLimitConfig.telemetry.maxRequests /
            (rateLimitConfig.telemetry.interval / (60 * 60 * 1000));

        expect(perHour).toBeGreaterThanOrEqual(60);
        // And still bounded — an unthrottled loop is orders of magnitude above.
        expect(perHour).toBeLessThan(1000);
    });
});

describe('what may be written', () => {
    it('rejects a module identifier that is not one', () => {
        expect(route).toContain('APP_IDENTIFIERS.includes(moduleId)');
    });

    it('uses the exported list rather than a fresh copy', () => {
        // The list already existed inside canAccessRoute. A second copy is how
        // two lists disagree later.
        expect(APP_IDENTIFIERS).toContain('academy');
        expect(APP_IDENTIFIERS).toContain('wave');
        expect(source('src/lib/role-app-mapping.ts')).toContain('export const APP_IDENTIFIERS');

        // And the original consumer now reads it too, rather than keeping its
        // own.
        const mapping = source('src/lib/role-app-mapping.ts');
        expect(mapping).toContain('APP_IDENTIFIERS.includes(firstSegment as AppIdentifier)');
        expect(mapping).not.toContain('const validApps: AppIdentifier[] = [');
    });

    it('restricts the event name that becomes an action', () => {
        // `action` is a typed union elsewhere and is what getAuditStatsAction
        // groups by, so an arbitrary string here pollutes both.
        expect(route).toMatch(/\/\^\[a-z0-9_\]\{1,48\}\$\//);
    });

    it('bounds metadata by size, not by shape', () => {
        // Open-ended metadata is the point of telemetry. Megabytes of it in the
        // audit collection is not.
        expect(route).toContain('MAX_METADATA_BYTES');
        expect(route).toContain('JSON.stringify(metadata).length > MAX_METADATA_BYTES');
    });

    it('still writes the fields it is for', () => {
        // Vacuity guard: rejecting everything would satisfy the assertions above
        // and delete the feature.
        const write = route.slice(route.indexOf('COLLECTIONS.AUDIT_LOGS'));

        expect(write.slice(0, 400)).toContain('action: `telemetry_${event}`');
        expect(write.slice(0, 400)).toContain('metadata: safeMetadata');
        expect(write.slice(0, 400)).toContain('userId: session.user.id');
    });

    it('keeps the telemetry_ prefix, which was already right', () => {
        // It namespaces these rows so a caller cannot forge `user_login` — the
        // mislabel fixed in #159, in reverse. Worth pinning rather than losing
        // in a rewrite.
        expect(route).toContain('`telemetry_${event}`');
    });
});

describe('the route still requires a session', () => {
    it('refuses an unauthenticated caller', () => {
        // What the earlier triage checked, and it was right. Pinned so the
        // additions above cannot displace it.
        const guardAt = route.indexOf('if (!session?.user?.id)');
        const limitAt = route.indexOf('telemetryLimiter.check');

        expect(guardAt).toBeGreaterThan(-1);
        expect(limitAt).toBeGreaterThan(guardAt);
    });
});
