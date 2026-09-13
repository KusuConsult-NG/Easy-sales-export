/**
 * @jest-environment node
 */

/**
 *   #708 THE CHAT BUBBLE WAS SHOWN TO EVERY VISITOR AND COULD ONLY EVER WORK
 *        FOR SOME OF THEM.
 *
 *   api/ai/route.ts refuses a request with no session, at step 1:
 *
 *       const session = (await requireSession()).session;
 *       if (!session?.user?.id) {
 *           return NextResponse.json({ error: "Authentication required" }, { status: 401 });
 *       }
 *
 *   That is deliberate and already tested — chatbot-session-integrity.test.ts
 *   asserts "a session is required" — so the route is not the defect.
 *
 *   ClientLayout rendered `<AiChatWidget />` UNCONDITIONALLY, and the widget
 *   carries no session check of its own: no useSession, no isAuthenticated, no
 *   auth import of any kind. So a logged-out visitor saw the bubble, typed a
 *   question, and the fetch came back 401. The widget's handler does
 *
 *       if (!response.ok) throw new Error(data.error || "Failed to get response");
 *
 *   and the catch renders:
 *
 *       "I'm sorry, I encountered a connection issue. Please try again or
 *        contact our support team directly."
 *
 *   Every time. For every anonymous visitor — which on a landing page is most
 *   of them. And the message is worse than the fault: "a connection issue"
 *   invites the person to try again, and trying again cannot work, because
 *   nothing was ever connecting. It was a door that was never open, described
 *   as one that might open shortly.
 *
 * ── THE PATTERN WAS ALREADY RIGHT ONE LINE ABOVE ────────────────────────────
 *
 *   The very same component computes `isAuthenticated` at the top and uses it
 *   for the push-notification banner:
 *
 *       {isAuthenticated && <PushNotificationBanner />}
 *       <AiChatWidget />                                  <- and then this
 *
 *   Two adjacent lines, one asking and one not. That is the shape this audit
 *   keeps finding: a correct rule applied to some of the places it names.
 *
 * ── WHY THE GATE, AND NOT OPENING THE ROUTE TO ANONYMOUS USERS ──────────────
 *
 *   RECORDED, because the opposite fix is arguable and was considered. The
 *   knowledge base reads as if it were written for prospects — its fallback
 *   rules answer "how do I register" and "which module interests you" — so a
 *   case exists for letting signed-out visitors chat.
 *
 *   It is not the change to make here. The session requirement is explicit,
 *   deliberate and covered by an existing test, and the rate limit, the session
 *   ownership check and the stored transcript are all keyed on a user id.
 *   Removing the requirement means re-keying the limiter on something else,
 *   deciding who owns an anonymous transcript, and accepting OpenAI cost from
 *   unauthenticated traffic. That is a product change with a bill attached, not
 *   a repair, and it is the owner's call rather than a side effect of fixing a
 *   broken bubble.
 *
 *   What is not arguable is the present state: offering a control that cannot
 *   work and blaming the network when it doesn't.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

/** Source with comments removed — this finding is quoted in several of them. */
function code(rel: string): string {
    return read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
}

const LAYOUT = 'src/components/layout/ClientLayout.tsx';
const WIDGET = 'src/components/ai/AiChatWidget.tsx';
const ROUTE = 'src/app/api/ai/route.ts';

describe('#708 — the chat is only offered to people it can serve', () => {
    it('THE SWEEP IS READING THE RIGHT FILES', () => {
        //   THE control: every assertion below is about the contents of these
        //   three files, and most are satisfied by an empty string.
        expect(code(LAYOUT)).toContain('AiChatWidget');
        expect(code(WIDGET).length).toBeGreaterThan(1000);
        expect(code(ROUTE)).toContain('export async function POST');
    });

    it('THE ROUTE STILL REQUIRES A SESSION — the premise, not the defect', () => {
        /*
         *   If this ever stops being true the gate below becomes unnecessary
         *   rather than wrong, and this test should be the one that says so.
         */
        const route = code(ROUTE);
        expect(route).toContain('requireSession()');
        expect(route).toContain('Authentication required');
        expect(route).toContain('{ status: 401 }');
    });

    it('AND THE WIDGET DRAWS NOTHING WITHOUT A SESSION', () => {
        /*
         *   THE fix, and it lives in the WIDGET — see #711 below for why not in
         *   the layout. Asserted as an early return before any markup, not
         *   merely as the file mentioning useSession.
         */
        const widget = code(WIDGET);
        expect(widget).toContain("import { useSession } from \"next-auth/react\"");
        expect(widget).toMatch(/if\s*\(\s*status\s*!==\s*["']authenticated["']\s*\)\s*return null;/);

        //   Before the first `return (` — a gate after the markup is not a gate.
        const gate = widget.indexOf('status !== "authenticated"');
        expect(gate).toBeGreaterThan(-1);
        expect(gate).toBeLessThan(widget.indexOf('<div className="fixed bottom-6 right-6'));
    });

    it('AND THE LAYOUT DOES NOT GATE IT A SECOND TIME — #711', () => {
        /*
         *   THE regression this finding cost 92 tests to learn. The gate was
         *   first written here as `{isAuthenticated && <AiChatWidget />}`,
         *   copying the push banner one line above, and the app's own
         *   page-render suite went from green to 92 empty pages — including
         *   static signed-out ones like /privacy.
         *
         *   The tests were at fault, not the conditional (see #711 in
         *   helpers/page-health), but the rule belongs in the widget regardless:
         *   the component that cannot work without a session is the one that
         *   should know it needs one, and having BOTH would mean two places to
         *   read before answering "when does this draw".
         */
        const layout = code(LAYOUT);
        expect(layout).toContain('<AiChatWidget />');
        expect(layout).not.toMatch(/\{\s*isAuthenticated\s*&&\s*<AiChatWidget/);
    });

    it('AND THE PUSH BANNER IS STILL GATED — the control', () => {
        /*
         *   Without this, "the layout gates nothing" would be satisfied by
         *   removing every conditional from the file. The banner's gate is
         *   correct and untouched, and it is what makes the widget's absence
         *   from that list a deliberate difference rather than a deletion.
         */
        expect(code(LAYOUT)).toMatch(/\{\s*isAuthenticated\s*&&\s*<PushNotificationBanner\s*\/>\s*\}/);
    });
});

/*
 * ── AND WHAT THIS FINDING COST TO GET RIGHT ─────────────────────────────────
 *
 *   The gate was FIRST written in ClientLayout as
 *
 *       {isAuthenticated && <AiChatWidget />}
 *
 *   copying the push banner one line above it. Every local gate passed — tsc,
 *   lint, the production build, 13,355 unit tests — and CI went from green to
 *   NINETY-TWO failing page-render tests, on pages that render perfectly.
 *
 *   The cause was not the conditional. Those tests read `innerText` one tick
 *   after domcontentloaded, when the page is parsed but not laid out, and this
 *   widget — fixed-position, outside the containers hidden until hydration —
 *   was supplying the only rendered text at that instant. Measured on
 *   /privacy: textContent 18,308 chars, innerText 0, innerText after 2s 2,343.
 *   The suite was passing on the chat bubble rather than on the pages. #711
 *   repairs that, in one shared helper rather than the five spellings it had.
 *
 *   Two lessons kept here rather than tidied away:
 *
 *     THE LOCAL GATE DOES NOT COVER RENDERING. Nothing in tsc, lint, build or
 *     13,355 unit tests could see this; only the browser suite could, and it
 *     runs in CI. A change to a layout that wraps every page needs that suite
 *     run before it is pushed, which is now what happens here.
 *
 *     AND THE FIRST FIX WAS NOT WRONG, WHICH IS WHY IT WAS TEMPTING TO FORCE.
 *     The honest reading was that a green suite had been relying on an
 *     accident, and the repair belonged in the suite — but the gate still moved
 *     into the widget, because a component that cannot work without a session
 *     is the one that should know it needs one.
 *
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Against a green baseline (5/5):
 *
 *   M1  the widget's session gate removed                          KILLED
 *   M2  the gate moved BELOW the markup it is meant to prevent      KILLED
 *   M3  the route stops requiring a session                        KILLED
 *   M4  the layout gates the widget a second time (the #711 shape)  KILLED
 *   CONTROL  an unrelated layout change (Toaster position)        SURVIVED
 *
 *   The push-banner assertion is what stops "the layout gates nothing" being
 *   satisfied by deleting every conditional in the file.
 *
 *   THE FIRST CONTROL WAS A BAD MUTANT AND IS RECORDED AS ONE. It added a
 *   `key` to the push banner — the exact element the control test pins — so it
 *   was killed, and by the assertion written for it. A control has to vary
 *   something the suite does not name; varying something it does name proves
 *   only that the mutant was chosen carelessly.
 */
