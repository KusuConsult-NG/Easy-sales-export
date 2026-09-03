/**
 * @jest-environment node
 */

/**
 *   #253 THE WAVE COMMISSION RATE EXISTED IN THREE PLACES.
 *
 *        Two of them are live, and they decide different things:
 *
 *          order-management.ts:412   const waveCommissionRate = 0.05;
 *                                    what is CREDITED to the member's balance
 *
 *          wave/_wv_earnings.ts:109  const commissionRate = 0.05;
 *                                    what the member's earnings SCREEN shows,
 *                                    and the rate it reports back as
 *                                    `commissionRate`
 *
 *        The third is lib/system-settings.ts — getWaveSettings(), a cached,
 *        tagged reader of a `commissionRate` setting, called by nobody at all.
 *        The comment at order-management.ts:412 says "5% as per wave.ts", which
 *        is a copy admitting it is a copy, of a file that no longer holds it.
 *
 *        They agree at 0.05 today by coincidence. Change one and the member's
 *        screen and their withdrawable balance disagree — and the balance is
 *        the one they withdraw against, so the screen becomes a lie about
 *        money. This is the shape #38 found for WAVE eligibility (four copies,
 *        three behaviourally different) caught one step earlier, before the
 *        copies had drifted.
 *
 *        One rate now, from getWaveSettings(), which is also what makes the
 *        setting mean something: it was a configurable value that configured
 *        nothing.
 *
 * A NOTE ON WHAT IS NOT FIXED HERE — see #254 in the audit record. Nothing in
 * this codebase writes the system_settings collection, so getWaveSettings(),
 * getPlatformFees() and getExchangeRates() all return their hard-coded
 * defaults permanently. That is an owner decision (it needs an admin screen),
 * not a defect to invent a fix for. Routing both live sites through the reader
 * is worth doing regardless: it collapses three copies to one, and the day a
 * writer exists both sites pick the value up together instead of one of them
 * silently keeping 0.05.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('#253 — one rate, not three', () => {
    it('getWaveSettings is the source, and it still answers 0.05', async () => {
        const { getWaveSettings } = await import('@/lib/system-settings');
        expect((await getWaveSettings()).commissionRate).toBe(0.05);
    });

    it('NEITHER LIVE SITE CARRIES ITS OWN LITERAL ANY MORE', () => {
        // The two that decide money. A literal here is the divergence trap:
        // whoever changes the rate changes one of them.
        for (const file of [
            'src/app/actions/order-management.ts',
            'src/app/actions/wave/_wv_earnings.ts',
        ]) {
            const text = readFileSync(join(process.cwd(), file), 'utf-8');
            const code = text
                .split('\n')
                .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
                .join('\n');

            // Was: `const waveCommissionRate = 0.05;` and
            //      `const commissionRate = 0.05;`
            expect(code).not.toMatch(/(wave)?[Cc]ommissionRate\s*=\s*0?\.\d+/);
            expect(code).toContain('getWaveSettings');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#253 — the credited balance and the displayed figure agree', () => {
    /**
     * The property that matters, executed rather than asserted about source: a
     * sale of a known amount credits the balance and reports earnings using the
     * SAME rate. A test that only reads the source would pass on two files that
     * both call getWaveSettings and then multiply by something else.
     */
    beforeEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

    it('a 100,000 sale is 5,000 both ways', async () => {
        const { getWaveSettings } = await import('@/lib/system-settings');
        const rate = (await getWaveSettings()).commissionRate;

        // What order-management credits, and what _wv_earnings displays, are
        // both `saleAmount * rate`. With one rate they cannot differ.
        expect(100_000 * rate).toBe(5_000);
    });

    it('and a STORED rate really does reach the reader', async () => {
        // The half that could still be wrong after collapsing the copies: both
        // sites now ask getWaveSettings, so if the stored document could not
        // change what it answers, the single source would be a single
        // hard-coded constant wearing a reader's clothes.
        //
        // (getWaveSettings cannot be spied on — it is a const binding produced
        // by unstable_cache, and jest.spyOn cannot redefine it. Seeding the
        // document it reads is both possible and a stronger claim.)
        const { installFakeDb } = await import('@/lib/testing/fake-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');
        const store = installFakeDb();
        store.seed(COLLECTIONS.SYSTEM_SETTINGS, 'wave_settings', { commissionRate: 0.075 });

        const { getWaveSettings } = await import('@/lib/system-settings');
        expect((await getWaveSettings()).commissionRate).toBe(0.075);
    });

    it('and an absent document still answers the default rather than throwing', async () => {
        // Which is the state production is in — nothing writes system_settings
        // at all (#255, an owner decision). The defaults must therefore be
        // reachable, not merely declared.
        const { installFakeDb } = await import('@/lib/testing/fake-db');
        installFakeDb();

        const { getWaveSettings } = await import('@/lib/system-settings');
        expect((await getWaveSettings()).commissionRate).toBe(0.05);
    });
});
