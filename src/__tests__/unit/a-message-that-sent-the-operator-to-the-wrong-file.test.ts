/**
 *   THE INSTRUCTION AND THE REASON CONTRADICTED EACH OTHER IN THE SAME LINE.
 *
 *       [ANALYTICS SERVICE] count_module_registrations unavailable — falling
 *       back to eight sequential scans of the users table, which is #909.
 *       Apply supabase/migrations/049_count_module_registrations.sql.
 *       Reason: canceling statement due to statement timeout
 *
 *   A function that TIMED OUT exists and ran. Applying the migration that
 *   creates it changes nothing, and the owner spent their attention on the one
 *   thing that could not be the cause. The message was written for the case its
 *   author had in mind — a deploy landing ahead of its migration, which 049's
 *   own header calls "the normal case here" — and then printed for every other
 *   case too.
 *
 *   #620, #621, #714 and #716 are the same finding: a check that cannot tell
 *   two states apart, reporting the one that reads as a fact. #716's is the
 *   nearest sibling, and the owner answered it the same way — "this IS set" —
 *   because they were right and the message was wrong.
 */

import { describe, it, expect } from '@jest/globals';
import { whyRpcUnavailable, rpcUnavailableAdvice } from '@/lib/rpc-unavailable';

const advise = (error: { code?: string; message?: string } | null) =>
    rpcUnavailableAdvice({
        fn: 'count_module_registrations',
        migration: 'supabase/migrations/049_count_module_registrations.sql',
        fallback: 'falling back to eight sequential scans.',
        error,
    });

describe('which of the three states the function is actually in', () => {
    it.each([
        ['PGRST202', 'Could not find the function public.count_module_registrations'],
        ['42883', 'function count_module_registrations() does not exist'],
    ])('%s is MISSING — apply the migration', (code, message) => {
        expect(whyRpcUnavailable({ code, message })).toBe('missing');
        expect(advise({ code, message })).toContain('apply supabase/migrations/049');
    });

    it('57014 is A TIMEOUT — and says the migration will NOT help', () => {
        const error = { code: '57014', message: 'canceling statement due to statement timeout' };

        expect(whyRpcUnavailable(error)).toBe('timed-out');

        const line = advise(error);
        //   THE DEFECT, ASSERTED AS AN ABSENCE. The old message said "Apply
        //   supabase/migrations/049" on this exact error.
        expect(line).toContain('will NOT help');
        expect(line).not.toMatch(/\bapply supabase\/migrations\/049/i);
    });

    it('reads the MESSAGE when no code came back', () => {
        //   Supabase's client does not always surface one — this platform has a
        //   live example: "count users: no message, code, details or hint".
        expect(whyRpcUnavailable({ message: 'canceling statement due to statement timeout' }))
            .toBe('timed-out');
        expect(whyRpcUnavailable({ message: 'Could not find the function public.x' }))
            .toBe('missing');
    });

    it('PRESCRIBES NOTHING when it cannot tell', async () => {
        //   Prescribing wrongly is the whole defect. A permission error is not
        //   a missing function and not a slow one.
        const error = { code: '42501', message: 'permission denied for function x' };

        expect(whyRpcUnavailable(error)).toBe('unknown');

        const line = advise(error);
        expect(line).toContain('no');
        expect(line).toContain('remedy is prescribed');
        expect(line).toContain('permission denied');
    });

    it.each([null, undefined, {}, { code: '  ' }])('does not guess on %p', (error) => {
        expect(whyRpcUnavailable(error as any)).toBe('unknown');
    });

    it('CARRIES THE RAW REASON in every case, so nothing is hidden by the verdict', () => {
        for (const error of [
            { code: 'PGRST202', message: 'Could not find the function' },
            { code: '57014', message: 'canceling statement due to statement timeout' },
            { code: '42501', message: 'permission denied for function x' },
        ]) {
            expect(advise(error)).toContain(error.message);
        }
    });
});

describe('and the two call sites use it', () => {
    it('NEITHER STILL SPELLS OUT "Apply supabase/migrations" ITSELF', () => {
        /*
         *   The rule is only a fix where it is called. Read from the source
         *   because the alternative — driving the real service far enough to
         *   log — needs a Supabase client this suite has no business building,
         *   and a mocked one would assert the mock.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');

        const source = readFileSync(
            join(process.cwd(), 'src/services/analytics.service.ts'), 'utf8');

        expect(source).toContain('rpcUnavailableAdvice');

        //   COMMENTS STRIPPED FIRST. The notes left at both call sites QUOTE
        //   the old wording so the next reader knows what was removed and why,
        //   and a naive grep reads that quotation as the defect returning.
        //   Asserting about code means asserting about code.
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/^\s*\/\/.*$/gm, ' ');

        expect(code).not.toMatch(/Apply\s*"?\s*\+?\s*"?supabase\/migrations/);
    });
});
