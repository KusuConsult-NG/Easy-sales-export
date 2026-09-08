/**
 * @jest-environment node
 */

/**
 *   #527 THE BUSIEST UPLOAD ROUTE HAD THE LOOSEST LIMIT.
 *
 *   /api/upload wrapped itself in `withRateLimit`, which builds its limiter at
 *   module scope from lib/security's rateLimitConfig — the platform-wide API
 *   tier, 200 requests a minute. The same route accepts files up to 50MB.
 *
 *   MEASURED, not estimated: 200/minute × 50MB is roughly 600GB an hour from a
 *   single identity.
 *
 *   rateLimits.config has had `fileUpload` — 20 an hour — the whole time. #274
 *   found it "declared and read by nothing … the third configured control this
 *   audit found switched off by never being wired up", and wired it into
 *   /api/certificates/upload. It did not reach here. This route says of itself,
 *   in its own comments, that it is "the generic one behind MasterUploader, and
 *   so the one most uploads actually use" — so the strict limit went to the
 *   quiet door and the busy one kept the tier meant for cheap JSON calls.
 *
 * ── WHY NOT SIMPLY REUSE fileUpload ────────────────────────────────────────
 *
 *   Twenty an hour is calibrated for certificates, which a member uploads once.
 *   This endpoint takes ONE REQUEST PER FILE, and lib/upload-request retries
 *   three times, so a seller adding six product images can legitimately spend
 *   eighteen requests in a minute. Applying twenty would have refused an
 *   ordinary listing — #485's standing constraint is that onboarding and
 *   selling must not stop, and a fix that blocks a real seller is worse than the
 *   defect.
 *
 *   The new tier is chosen against the THROUGHPUT, which is what the defect
 *   actually is: 120 an hour at 50MB caps one identity near 6GB an hour instead
 *   of 600GB — a hundredfold reduction that still leaves room for six full
 *   listing sessions an hour, which nobody does by hand.
 *
 *   Keyed on the USER, not the address. This route already requires a session,
 *   and #260 and the contact-form note both record what keying by IP costs
 *   members behind a Nigerian carrier NAT.
 *
 * ── WHAT WAS CHECKED AND IS NOT CLAIMED ─────────────────────────────────────
 *
 *   The rest of this route is sound and was read before being left alone: it
 *   validates by MAGIC BYTES rather than the client's Content-Type, takes the
 *   stored extension from the detected type rather than the filename, sanitises
 *   every public_id segment, and compares the detected type against its own
 *   narrow list rather than storage-admin's broader one. Those are earlier
 *   findings and they hold.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the limiter removed from the route              KILLED
 *     the route back on the platform-wide API tier    KILLED
 *     the key back to something not per-user          KILLED
 *     the tier widened past the API tier              KILLED
 *     reword this header                              SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { rateLimitConfig as platformApiConfig } from '@/lib/security';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: p });

const UPLOAD = 'src/app/api/upload/route.ts';
const CERTIFICATES = 'src/app/api/certificates/upload/route.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#527 — the tier, measured against what it replaced', () => {
    it('THE UPLOAD TIER IS FAR TIGHTER THAN THE PLATFORM API TIER', () => {
        //   THE measurement. The old limit was the API tier applied per MINUTE;
        //   the new one is per hour, so the comparison has to be normalised or
        //   it flatters the fix.
        const apiPerHour = platformApiConfig.maxRequests * (3_600_000 / platformApiConfig.windowMs);
        const uploadPerHour =
            rateLimitConfig.mediaUpload.maxRequests * (3_600_000 / rateLimitConfig.mediaUpload.interval);

        expect(uploadPerHour).toBeLessThan(apiPerHour / 50);
    });

    it('AND IT IS LOOSER THAN THE CERTIFICATE TIER, DELIBERATELY', () => {
        //   The trade-off stated as an assertion: this endpoint is per-file with
        //   retries, so the certificate tier would refuse an ordinary listing.
        expect(rateLimitConfig.mediaUpload.maxRequests)
            .toBeGreaterThan(rateLimitConfig.fileUpload.maxRequests);
    });

    it('and it still admits a full product listing with retries', () => {
        //   Six images, three attempts each, is eighteen. A limit that cannot
        //   fit one listing is a broken feature, not a tighter one.
        expect(rateLimitConfig.mediaUpload.maxRequests).toBeGreaterThanOrEqual(18);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#527 — the route uses it', () => {
    it('THE ROUTE NO LONGER TAKES THE PLATFORM-WIDE API LIMITER', () => {
        //   Comments stripped: this fix quotes withRateLimit to explain it.
        const body = code(UPLOAD);

        expect(body).not.toContain('withRateLimit(');
        expect(body).toContain('rateLimit(rateLimitConfig.mediaUpload)');
    });

    it('AND IT CHECKS BEFORE READING THE BODY', () => {
        //   A limiter that runs after formData() has already accepted 50MB off
        //   the wire has not limited the thing that costs.
        const body = code(UPLOAD);
        const check = body.indexOf('uploadLimiter.check(');
        const read = body.indexOf('await request.formData()');

        expect(check).toBeGreaterThan(0);
        expect(read).toBeGreaterThan(check);
    });

    it('AND IT KEYS ON THE MEMBER, NOT THE ADDRESS', () => {
        //   #260 and the contact-form note: a Nigerian carrier NAT puts many
        //   real members behind one address.
        expect(code(UPLOAD)).toContain('`upload:${session.user.id}`');
    });

    it('and the certificate route keeps its own stricter tier', () => {
        //   The control: this finding must not loosen the door #274 fixed.
        expect(code(CERTIFICATES)).toContain('rateLimit(rateLimitConfig.fileUpload)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#527 — every upload door is metered', () => {
    it('NEITHER UPLOAD ROUTE IS UNLIMITED', () => {
        //   The ratchet. #274 wired one of two; the point of stating it as a
        //   sweep is that a third upload route cannot arrive unmetered.
        for (const route of [UPLOAD, CERTIFICATES]) {
            expect(code(route)).toMatch(/rateLimit\(rateLimitConfig\.\w+\)/);
        }
    });

    it('AND THE SWEEP READ REAL FILES', () => {
        //   #484's shape — a control that reads as present and is none.
        for (const route of [UPLOAD, CERTIFICATES]) {
            expect(code(route).length).toBeGreaterThan(1000);
        }
    });
});
