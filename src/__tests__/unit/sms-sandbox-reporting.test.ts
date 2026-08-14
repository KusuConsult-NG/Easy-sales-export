/**
 * @jest-environment node
 */

/**
 * An SMS broadcast in sandbox mode reported "Sent 500, Failed 0".
 *
 * THE BUG
 * -------
 * sms-broadcast.ts reads the Africa's Talking username like this:
 *
 *     const atUsername = process.env.AT_USERNAME || "sandbox";
 *
 * so "sandbox" is the value when the variable is UNSET, not only when someone
 * chooses it. In that mode the API accepts every message and delivers none of
 * them.
 *
 * The code knows. It computes the flag and writes it:
 *
 *     sandboxMode: atUsername.toLowerCase() === "sandbox",
 *
 * into the sms_broadcast_logs document — and returned it to nobody. The action's
 * data was { sent, failed, skipped, logId }, and the screen turned that into
 *
 *     toast.success(`Complete: Sent ${res.data.sent}, Failed ${res.data.failed}`)
 *
 * The only other signal was a logger.warn, which the person clicking Send never
 * sees. So the counts were true about what the API accepted and silent about
 * what anyone received.
 *
 * THE PRECEDENT
 * -------------
 * docs/audit/outstanding-work.md records the same shape against push
 * notifications: "the messaging layer was a stub that returned a fake success id
 * for every send, so nothing was ever delivered while the logs reported
 * success." Same failure, different channel — and this one is a single unset
 * environment variable away at all times.
 *
 * THE FIX
 * -------
 * sandboxMode travels back with the counts, and the screen says so instead of
 * congratulating the sender. `sent` is left alone: it is an honest count of what
 * the API accepted, and rewriting it to zero would replace one lie with another.
 *
 * HOW IT WAS FOUND
 * ----------------
 * The written-but-never-read sweep from #214, second pass. The first pass asked
 * "is this field read?"; this one asks "should something act on it?" — which is
 * the question that separates provenance fields like reviewedBy from flags whose
 * whole purpose is to change what someone does next.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const ACTION = 'src/app/actions/sms-broadcast.ts';
const PAGE = 'src/app/admin/communications/sms/page.tsx';

describe('the sender is told when nothing was delivered', () => {
    it('the action returns sandboxMode, not only logs it', () => {
        // THE test. It was written to sms_broadcast_logs and to nowhere the
        // caller could see.
        const code = codeOnly(source(ACTION));

        expect(code).toContain('sandboxMode: atUsername.toLowerCase() === "sandbox"');
        // Returned to the caller, not merely computed: the flag must sit in the
        // same data object as logId — the success return, not the catch below it.
        const logIdAt = code.indexOf('logId: logRef.id');
        expect(logIdAt).toBeGreaterThan(-1);
        const dataObject = code.slice(code.lastIndexOf('data:', logIdAt), code.indexOf('}', logIdAt) + 1);
        expect(dataObject).toContain('sandboxMode');
    });

    it('and the result type admits it', () => {
        // Without this the page cannot read the field, which is how it stayed
        // invisible: the value existed and the type did not.
        expect(source(ACTION)).toContain('sandboxMode?: boolean;');
    });

    it('the screen reports it as a failure, not a success', () => {
        const code = codeOnly(source(PAGE));

        expect(code).toContain('res.data.sandboxMode');
        expect(code).toContain('SANDBOX MODE');
    });

    it('the success toast is now the else branch', () => {
        // Vacuity guard: leaving the success toast unconditional would show
        // both messages, and the green one is the one people believe.
        const page = codeOnly(source(PAGE));
        const sandboxAt = page.indexOf('res.data.sandboxMode');
        const successAt = page.indexOf('Complete: Sent');

        expect(sandboxAt).toBeGreaterThan(-1);
        expect(successAt).toBeGreaterThan(sandboxAt);
        expect(page.slice(sandboxAt, successAt)).toContain('} else {');
    });
});

describe('what the fix deliberately does not do', () => {
    it('leaves the sent count alone', () => {
        // It is an honest count of what the API accepted. Zeroing it would
        // replace one wrong number with another, and hide a real failure rate.
        const code = codeOnly(source(ACTION));

        expect(code).toContain('sent,');
        expect(code).not.toContain('sent: 0,');
    });

    it('still keeps the server-side warning', () => {
        // The log line was not the problem; being the ONLY signal was.
        expect(source(ACTION)).toContain('NOT reach real phones');
    });
});

describe('the default is the dangerous one', () => {
    it('an unset AT_USERNAME means sandbox', () => {
        // This is why the flag matters at all: sandbox is not an opt-in, it is
        // what you get by forgetting.
        expect(codeOnly(source(ACTION))).toContain('process.env.AT_USERNAME || "sandbox"');
    });
});
