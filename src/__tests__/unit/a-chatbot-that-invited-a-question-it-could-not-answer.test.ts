/**
 * @jest-environment node
 */

/**
 *   #914 IT INVITED THREE MONEY QUESTIONS AND COULD ANSWER NONE OF THEM.
 *
 *   Found auditing src/lib/chatbot-knowledge.ts — one of the files no test had
 *   named. My first guess about it was wrong in the useful direction: I went
 *   looking for a STALE price, because #1, #2, #18 and #21 of this audit were all
 *   a copy of a fee disagreeing with the one checkout charges. There is no stale
 *   price in that file. There is no price in it at all.
 *
 *   MEASURED: the module knowledge said "pay membership fee if applicable" and
 *   "Fees vary by course — check course page", and the whole file contained no
 *   `₦` and no digit group. Meanwhile the quick actions the widget puts in front
 *   of the user include, verbatim:
 *
 *       cooperative   "What is the membership fee?"
 *       academy       "Are courses free?"
 *
 *   buildSystemPrompt takes a module and nothing else, and api/ai/route.ts sends
 *   its output straight to OpenAI as the system message. So the platform hands a
 *   member a button that asks a money question, and gives the model answering it
 *   nothing to answer from.
 *
 * ── WHY THAT IS WORSE THAN SILENCE ──────────────────────────────────────────
 *
 *   The prompt says "Always offer a next action" and "Keep responses concise
 *   (2-4 sentences max)", it has a TONE RULES section that forbids saying "You
 *   are not eligible", and it never once says "do not state a figure you were not
 *   given". A model under those instructions, asked "What is the membership
 *   fee?", does not answer "I don't know" — it produces a plausible Nigerian
 *   amount. The real answer is one flat ₦10,000, and the whole reason #2 exists
 *   is that a second cooperative fee figure existed once and was wrong.
 *
 *   So this is the same defect class as those four, arriving from the other side:
 *   not a hardcoded copy that drifted, but NO copy where the user was invited to
 *   ask.
 *
 * ── THE FIX IS BOTH HALVES ──────────────────────────────────────────────────
 *
 *   The figures are in the prompt, built from COOPERATIVE_CONFIG and
 *   ACADEMY_CONFIG — the constants the checkouts read — so the answer cannot
 *   drift from the price. And the model is told not to state any amount it was
 *   not given, which covers everything that genuinely varies: export windows,
 *   land, WAVE, individual products and delivery. Grounding without the
 *   prohibition just moves the invention to the next question.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    buildSystemPrompt,
    feeKnowledge,
    MODULE_CONFIGS,
    type ChatbotModule,
} from '@/lib/chatbot-knowledge';
import { COOPERATIVE_CONFIG, ACADEMY_CONFIG } from '@/lib/constants';

const ROOT = process.cwd();
const MODULES = Object.keys(MODULE_CONFIGS) as ChatbotModule[];

/** ₦ with en-NG grouping, the way every screen writes a fee. */
const naira = (amount: number) => `₦${amount.toLocaleString('en-NG')}`;

describe('#914 — the quick actions that ask for a figure', () => {
    it('THE CONTROL: the widget really does offer those buttons', () => {
        //   First, because the whole finding rests on the user being invited to
        //   ask. If these strings change, the rest of this suite is about a
        //   question nobody is prompted to put.
        expect(MODULE_CONFIGS.cooperative.quickActions).toContain('What is the membership fee?');
        expect(MODULE_CONFIGS.academy.quickActions).toContain('Are courses free?');
    });

    it('and every module offers some quick actions at all', () => {
        for (const chatModule of MODULES) {
            expect(MODULE_CONFIGS[chatModule].quickActions.length).toBeGreaterThan(0);
        }
    });
});

describe('#914 — the prompt can now answer them, from the checkout constants', () => {
    it('THE COOPERATIVE FEE IS THE ONE THE CHECKOUT CHARGES', () => {
        const prompt = buildSystemPrompt('cooperative');

        expect(prompt).toContain(naira(COOPERATIVE_CONFIG.registrationFee));
        //   And it says there is only one, because #2 retired the second tier and
        //   a model told "a fee" will happily imply a range.
        expect(prompt).toMatch(/one flat fee/i);
        expect(prompt).toMatch(/no tiers/i);
    });

    it('THE ACADEMY FEES ARE THE THREE THE CHECKOUT CHARGES', () => {
        const prompt = buildSystemPrompt('academy');

        for (const plan of Object.values(ACADEMY_CONFIG.plans)) {
            expect(prompt).toContain(naira(plan.fee));
            //   The pre-discount figure too: the screens show both, and a member
            //   quoted only the lower one reads the discount as the list price.
            expect(prompt).toContain(naira(plan.originalFee));
        }

        //   The question the button asks, answered.
        expect(prompt).toMatch(/NOT free/i);
    });

    it('IT IS NOT A HARDCODED COPY — the constants drive it', () => {
        //   The point of the fix, and the thing a literal in the prompt would
        //   fail. feeKnowledge() is called with the real constants here; the
        //   mutation test for this is changing COOPERATIVE_CONFIG and seeing the
        //   prompt follow, which is recorded in the commit rather than faked with
        //   a module mock.
        const knowledge = feeKnowledge();

        expect(knowledge).toContain(naira(COOPERATIVE_CONFIG.registrationFee));
        expect(knowledge).toContain(naira(ACADEMY_CONFIG.plans.standard.fee));

        //   The formatted figure is derived, so a fee of a different magnitude
        //   still formats correctly rather than being a string somebody typed.
        expect(naira(COOPERATIVE_CONFIG.registrationFee)).toBe('₦10,000');
        expect(naira(ACADEMY_CONFIG.plans.elite.fee)).toBe('₦270,000');
    });

    it('and every module gets the fee block, not just those two', () => {
        //   A member can ask the Marketplace assistant what cooperative
        //   membership costs. The block is in SHARED_KNOWLEDGE's position for
        //   that reason.
        for (const chatModule of MODULES) {
            expect(buildSystemPrompt(chatModule)).toContain(naira(COOPERATIVE_CONFIG.registrationFee));
        }
    });
});

describe('#914 — and it is told not to invent the figures it was not given', () => {
    it('EVERY MODULE PROMPT CARRIES THE PROHIBITION', () => {
        //   Grounding alone just moves the invention to the next question: the
        //   widget has no "what does a land partnership cost" button, but a user
        //   can type it.
        for (const chatModule of MODULES) {
            const prompt = buildSystemPrompt(chatModule);

            expect(prompt).toMatch(/NEVER state a money amount that is not written in this prompt/i);
            expect(prompt).toMatch(/NEVER invent, approximate/i);
        }
    });

    it('and it names the things that genuinely vary', () => {
        //   Not a blanket refusal. Each of these has a real page with a real
        //   number on it, and "check the page" is the true answer rather than a
        //   dodge.
        const knowledge = feeKnowledge();

        for (const varies of ['Export window', 'land price', 'WAVE amount', 'product price', 'delivery cost']) {
            const stem = varies.split(' ')[0];
            expect(knowledge.toLowerCase()).toContain(stem.toLowerCase());
        }
    });

    it('POSITIVE CONTROL: the prompt is still the prompt', () => {
        //   Several assertions above are `toMatch` on a long string, and a
        //   truncated or empty prompt would fail them loudly — but the module
        //   knowledge is what the assistant is FOR, and adding a fee block must
        //   not have displaced it.
        const prompt = buildSystemPrompt('wave');

        expect(prompt).toContain('RH-WAVE 774');
        expect(prompt).toContain('NOT a cash handout');
        expect(prompt).toContain('info@easysalesexport.com');
        expect(prompt.length).toBeGreaterThan(2_000);
    });
});

describe('#914 — the file that had no figures in it', () => {
    it('THE MEASUREMENT, pinned: the only amounts in it are derived', () => {
        /*
         *   Before the fix this file contained no `₦` and no digit group outside
         *   the hex colours. It now contains neither a literal fee nor a literal
         *   ₦ amount either — the figures arrive through COOPERATIVE_CONFIG and
         *   ACADEMY_CONFIG.
         *
         *   Comments stripped, because the header above feeKnowledge() explains
         *   the finding using the real numbers, and an unstripped read would find
         *   ₦10,000 in the explanation and call it a hardcoded fee. That is the
         *   trap this repo records and I have now hit four times in this audit.
         */
        const code = stripComments(readFileSync(join(ROOT, 'src/lib/chatbot-knowledge.ts'), 'utf8'), {
            label: 'chatbot-knowledge',
            minRetainedRatio: 0.2,
        });

        //   No naira literal, and no bare fee-sized number.
        expect(code).not.toMatch(/₦[\d,]/);
        expect(code).not.toMatch(/\b(10|25|45|50|90|100|270|300)[,_]?000\b/);

        //   It reads them from the one place instead.
        expect(code).toContain('COOPERATIVE_CONFIG.registrationFee');
        expect(code).toContain('ACADEMY_CONFIG.plans');
    });

    it('POSITIVE CONTROL: the stripper left the module knowledge behind', () => {
        //   Two `not.toMatch`es above, both of which pass on an empty string.
        const code = stripComments(readFileSync(join(ROOT, 'src/lib/chatbot-knowledge.ts'), 'utf8'), {
            label: 'chatbot-knowledge',
            minRetainedRatio: 0.2,
        });

        expect(code).toContain('MODULE_KNOWLEDGE');
        expect(code).toContain('buildSystemPrompt');
        expect(code.length).toBeGreaterThan(3_000);
    });

    it('and the hex colours are still there, unbothered by the digit sweep', () => {
        //   The sweep above forbids fee-sized numbers, and this file is full of
        //   `#16a34a`. Asserted so that a future tightening of that regex into
        //   "no digits at all" fails here rather than quietly deleting the theme.
        expect(MODULE_CONFIGS.hub.accentColor).toMatch(/^#[0-9a-f]{6}$/i);
        expect(MODULE_CONFIGS.academy.gradientFrom).toMatch(/^#[0-9a-f]{6}$/i);
    });
});
