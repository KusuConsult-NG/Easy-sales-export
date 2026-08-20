/**
 * The WAVE compliance report must not state figures it did not measure.
 *
 * WHAT IT WAS REPORTING
 * ---------------------
 * Five of the numbers on the compliance screen and in its downloadable report were
 * not measurements:
 *
 *   repaymentRate     `let repaymentRate = 85; // reasonable default when no data`
 *                     — returned whenever LOANS was empty or either count threw,
 *                     rendered by the page as `{stats.repaymentRate}%`.
 *
 *   totalDisbursed    `amountDisbursed` is not a field on a WAVE application and no
 *   averageLoanSize   writer sets one, so the `> 0` filter matched nothing and both
 *                     were always 0 — presented as ₦0, which reads as "nothing was
 *                     disbursed" rather than "nobody records this".
 *
 *   states            selected `state`; the schema has `stateOfResidence` and
 *                     `stateOfOrigin`. Every row fell to `|| "Unknown"`.
 *
 *   businessTypes     selected `businessType`, an EXPORT field. Every row fell to
 *                     `|| "Other"`.
 *
 * And five of the thirteen CSV columns — Business Name, Business Type, Years in
 * Business, Amount Requested, Amount Disbursed — were phantom fields, exporting
 * blank or 0 for every applicant.
 *
 * A fabricated compliance figure is worse than a missing one: it is
 * indistinguishable from a reading, and it is the number somebody quotes.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROUTE = 'src/app/api/admin/wave/compliance/route.ts';
const EXPORT_ROUTE = 'src/app/api/admin/wave/reports/export/route.ts';
const PAGE = 'src/app/admin/wave/compliance/page.tsx';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('the repayment rate is measured or absent, never invented', () => {
    it('has no default value', () => {
        const src = code(ROUTE);

        expect(src).not.toMatch(/repaymentRate\s*=\s*85/);
        expect(src).toContain('let repaymentRate: number | null = null;');
    });

    it('is only set when there are loans to divide by', () => {
        const src = code(ROUTE);
        expect(src).toContain('if (totalLoans > 0) {');
    });

    it('reports the basis it was computed from', () => {
        // So a reader can tell 100% of two loans from 100% of two thousand.
        const src = code(ROUTE);

        expect(src).toContain('repaymentBasis = { totalLoans, repaidLoans }');
        expect(src).toContain('repaymentMeasured: repaymentRate !== null');
    });

    it('logs rather than swallows a failed computation', () => {
        // The old catch was an empty `{}` with a "fall back to default" comment,
        // which is how the 85 became invisible.
        const src = code(ROUTE);
        const block = src.slice(src.indexOf('let repaymentRate'));

        expect(block.slice(0, 1200)).toContain('logger.error');
    });

    it('the page renders no figure when it was not measured', () => {
        const src = code(PAGE);

        // Matched as the RAW JSX form — a `{` not preceded by `$`.
        //
        // A plain substring check for `{stats.repaymentRate}%` flagged the corrected
        // code, because the fix renders it inside a template literal as
        // `${stats.repaymentRate}%` and the old expression is a substring of the new
        // one. The test failed against a file that was already right.
        expect(src).not.toMatch(/[^$]\{stats\.repaymentRate\}%/);

        // The guard, and the two states it distinguishes.
        expect(src).toContain('stats.repaymentRate === null || stats.repaymentRate === undefined');
        expect(src).toContain('? "No data"');
        expect(src).toContain('repaymentRate: number | null');
    });
});

describe('disbursement is reported as untracked, not as zero', () => {
    it('the route says which it is', () => {
        const src = code(ROUTE);

        expect(src).toContain('disbursementTracked: totalDisbursed > 0');
        expect(src).toContain('dataAvailability');
    });

    it('the page shows "Not tracked" rather than a currency figure', () => {
        const src = code(PAGE);

        expect(src).toContain('!dataAvailability.disbursementTracked');
        expect(src).toContain('"Not tracked"');
        // Wired from the response, or the flag is always undefined and the tiles
        // silently fall back to showing ₦0 again.
        expect(src).toContain('setDataAvailability(data.dataAvailability ?? null)');
    });

    it('the downloadable report says so in words', () => {
        const src = source(EXPORT_ROUTE);

        expect(src).toContain('an absence of data, not a figure of zero');

        // And the flag has to GATE the financial summary, not merely exist in the
        // file. The first version of this test checked only that the identifier
        // appeared, so replacing the condition with `true` — reinstating the ₦0
        // figures — still passed.
        expect(src).toContain('${disbursementTracked ? `');
        expect(src).toContain('const disbursementTracked = disbursementRows.length > 0;');

        // The two branches must differ: a figure when tracked, prose when not.
        const summary = src.slice(src.indexOf('<h2>Financial Summary</h2>'));
        const block = summary.slice(0, 900);
        expect(block).toContain('Total Disbursed:');
        expect(block).toContain('no\n    disbursed total');
    });
});

describe('the demographics read fields the collection has', () => {
    it('selects the real state and occupation fields', () => {
        const src = code(ROUTE);

        expect(src).toContain('"stateOfResidence"');
        expect(src).toContain('"currentOccupation"');
        expect(src).not.toMatch(/select\([^)]*"businessType"/);
    });

    it('groups by them', () => {
        // Selecting the right fields and then grouping by the wrong ones would pass
        // the test above and change nothing.
        const src = code(ROUTE);

        expect(src).toContain('data.stateOfResidence || data.stateOfOrigin || "Unknown"');
        expect(src).toContain('data.currentOccupation || "Unspecified"');
        expect(src).not.toContain('data.businessType');
        expect(src).not.toMatch(/const state = data\.state \|\|/);
    });
});

describe('the CSV exports columns that exist', () => {
    it('drops the five phantom columns', () => {
        const src = code(EXPORT_ROUTE);
        const headers = src.slice(src.indexOf('const headers = ['), src.indexOf('];', src.indexOf('const headers = [')));

        for (const phantom of [
            'Business Name',
            'Business Type',
            'Years in Business',
            'Amount Requested',
            'Amount Disbursed',
        ]) {
            expect(headers).not.toContain(phantom);
        }
    });

    it('and reads none of those fields in the rows', () => {
        const src = code(EXPORT_ROUTE);
        const rows = src.slice(src.indexOf('const rows = applications.map'), src.indexOf('const csvContent'));

        expect(rows).not.toContain('app.businessName');
        expect(rows).not.toContain('app.businessType');
        expect(rows).not.toContain('app.yearsInBusiness');
        expect(rows).not.toContain('app.amountRequested');
        expect(rows).not.toContain('app.amountDisbursed');
    });

    it('exports what the form actually collects', () => {
        const src = code(EXPORT_ROUTE);

        expect(src).toContain('app.currentOccupation');
        expect(src).toContain('app.averageMonthlyIncome');
        expect(src).toContain('list(app.valueChainAreas)');
        expect(src).toContain('list(app.preferredCommodities)');
        expect(src).toContain('app.isMemberOfCooperative');
    });

    it('flattens the array fields rather than printing [object Object]', () => {
        const src = code(EXPORT_ROUTE);
        expect(src).toContain('const list = (v: unknown) => (Array.isArray(v) ? v.join("; ") : (v ?? ""))');
    });
});

describe('an undated application is not dated to the export', () => {
    it('the route leaves it null', () => {
        const src = code(EXPORT_ROUTE);

        expect(src).not.toContain('?? new Date().toISOString(),');
        expect(src).toContain('?? appData.createdAt ?? null,');
    });

    it('and both renderings say Unknown', () => {
        const src = code(EXPORT_ROUTE);
        expect((src.match(/"Unknown"/g) || []).length).toBeGreaterThanOrEqual(2);
    });
});

describe('the state on an exported row prefers the applicant\'s own declaration', () => {
    it('reads stateOfResidence first', () => {
        // The chain began with `appData.state` and `appData.residentialState`,
        // neither of which a WAVE application carries — so it resolved through a
        // USER-document fallback three links down, and never used the residence the
        // applicant actually declared on the form.
        const src = code(EXPORT_ROUTE);
        expect(src).toContain('let state = appData.stateOfResidence || appData.stateOfOrigin');
    });
});

describe('the downloaded report is named for what it is', () => {
    it('takes its extension from the response Content-Type', () => {
        // `format=pdf` renders HTML and returns text/html; the page saved those
        // bytes as `.pdf`, producing a file no reader opens.
        const src = code(PAGE);

        expect(src).not.toContain('`wave_compliance_report_${Date.now()}.${format}`');
        expect(src).toContain('const contentType = response.headers.get("Content-Type")');
        expect(src).toContain('contentType.includes("text/html")');
        expect(src).toContain('`wave_compliance_report_${Date.now()}.${extension}`');
    });

    it('still honours a genuine PDF if one is ever produced', () => {
        // So the mapping is not a rename that blocks the real fix.
        const src = code(PAGE);
        expect(src).toContain('contentType.includes("application/pdf")');
    });
});

describe('the approved count is named for what it counts', () => {
    it('exposes it as approvedApplications alongside activeMembers', () => {
        // `activeMembers: approved` is the count of approved APPLICATIONS — 474 in
        // production — not the number of accounts holding the WAVE role, which is
        // 15,128. The two were being reported under one name.
        const src = code(ROUTE);

        expect(src).toContain('activeMembers: approved');
        expect(src).toContain('approvedApplications: approved');
    });
});

describe('an enrolment date is never invented', () => {
    /**
     * Two fabrications were stacked on one field.
     *
     * getStandardWaveApplicationsAction's approved branch synthesises a row per
     * role-holder and set `approvalTimestamp` from `uData.createdAt` — falling back
     * to `new Date()`. The admin members page then read that field and applied its
     * OWN `|| new Date()` behind it. So a member with no recorded creation date was
     * shown, and exported to CSV twice, as having enrolled today.
     */
    const ADMIN_APPS = 'src/app/actions/wave/_wv_admin_applications.ts';
    const MEMBERS_PAGE = 'src/app/admin/wave/members/page.tsx';

    it('the action leaves the synthesised timestamp null', () => {
        const src = code(ADMIN_APPS);

        expect(src).not.toMatch(/const approvalDate = uData\.createdAt \?[^;]*: new Date\(\);/);
        expect(src).toContain('const approvalTs = approvalDate && !Number.isNaN(approvalDate.getTime())');
        expect(src).toContain('approvalTimestamp: approvalTs,');
    });

    it('and guards against an unparseable date as well as a missing one', () => {
        // `new Date(garbage)` is an Invalid Date, not a throw, and
        // Timestamp.fromDate on it would have produced NaN seconds.
        const src = code(ADMIN_APPS);
        expect(src).toContain('!Number.isNaN(approvalDate.getTime())');
    });

    it('the page no longer falls back to today either', () => {
        const src = code(MEMBERS_PAGE);

        expect(src).not.toContain('data.createdAt?.toDate?.() || new Date()');
        expect((src.match(/data\.createdAt\?\.toDate\?\.\(\) \|\| null/g) || []).length).toBe(2);
        expect(src).toContain('enrolledAt: Date | null');
    });

    it('every place that renders it handles the absence', () => {
        // The list, the detail panel and both CSV writers. One unguarded
        // `new Date(null)` renders as 1 January 1970, which is a different lie.
        const src = code(MEMBERS_PAGE);

        expect(src).not.toMatch(/\{new Date\(member\.enrolledAt\)\.toLocaleDateString/);
        expect(src).not.toMatch(/value: new Date\(selectedMember\.enrolledAt\)/);
        expect((src.match(/"Unknown"/g) || []).length).toBeGreaterThanOrEqual(4);
    });
});

describe('the training-sessions route resolves access from the database too', () => {
    /**
     * It read serviceRegistrations.wave.status off the SESSION alone. That value is
     * minted at login and refreshed hourly, which is why module-access-check.ts
     * carries a database fallback for exactly this field. The /wave/(member) layout
     * uses that fallback and admits a newly approved member; this route had none and
     * answered 403 for up to an hour, so she sat inside the programme looking at a
     * screen telling her she had no access to it.
     */
    const SESSIONS_ROUTE = 'src/app/api/wave/training-sessions/route.ts';

    it('falls back to the stored record when the session does not grant access', () => {
        const src = code(SESSIONS_ROUTE);

        expect(src).toContain('let allowed = canReadWaveProgramme(');
        expect(src).toContain('if (!allowed) {');
        expect(src).toContain('.collection(COLLECTIONS.USERS)');
    });

    it('re-reads the stored roles, not only the status', () => {
        // An admin whose role was granted after login is in the same position.
        const src = code(SESSIONS_ROUTE);
        expect(src).toContain('roles: Array.isArray(fresh.roles) ? fresh.roles : session.user.roles,');
    });

    it('keeps the same rule, rather than swapping in a stricter one', () => {
        // canReadWaveProgramme deliberately admits someone mid-application;
        // checkModuleAccess requires "approved". Only the source of the status
        // changed.
        const src = code(SESSIONS_ROUTE);

        expect(src).toContain('canReadWaveProgramme');
        expect(src).not.toContain('checkModuleAccess');
    });

    it('does not query on the ordinary request', () => {
        // The fallback sits inside the refusal branch, so a member whose session
        // already grants access costs no extra read.
        const src = code(SESSIONS_ROUTE);
        const firstCheck = src.indexOf('let allowed = canReadWaveProgramme(');
        const fallback = src.indexOf('.collection(COLLECTIONS.USERS)');
        const guard = src.indexOf('if (!allowed) {');

        expect(guard).toBeGreaterThan(firstCheck);
        expect(fallback).toBeGreaterThan(guard);
    });

    it('logs a failed fallback rather than swallowing it', () => {
        const src = code(SESSIONS_ROUTE);
        expect(src).toContain('Access fallback lookup failed');
    });
});
