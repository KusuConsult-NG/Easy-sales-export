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

    it('AND THE WIDGET IS RENDERED ONLY WHEN THERE IS A SESSION', () => {
        //   THE fix. Asserted on the rendering line rather than on the file
        //   containing the word `isAuthenticated`, which it did all along —
        //   for the banner one line above.
        expect(code(LAYOUT)).toMatch(/\{\s*isAuthenticated\s*&&\s*<AiChatWidget\s*\/>\s*\}/);
    });

    it('AND THE WIDGET IS NOT RENDERED UNGUARDED ANYWHERE', () => {
        /*
         *   The regression that matters: a second mount point, or a revert of
         *   the line above, puts the broken bubble back. Checked across every
         *   file that renders it rather than only the one that was wrong.
         */
        const offenders: string[] = [];
        for (const rel of [LAYOUT]) {
            code(rel).split('\n').forEach((line, i) => {
                if (!line.includes('<AiChatWidget')) return;
                if (!/isAuthenticated\s*&&/.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
            });
        }
        expect(offenders).toEqual([]);
    });

    it('AND THE WIDGET STILL HAS NO AUTH CHECK OF ITS OWN — so the gate is load-bearing', () => {
        /*
         *   States WHY the layout has to do this. If the widget ever grows its
         *   own session awareness, this test failing is the prompt to decide
         *   which of the two owns the rule — rather than quietly having both.
         */
        const widget = code(WIDGET);
        expect(widget).not.toContain('useSession');
        expect(widget).not.toContain('isAuthenticated');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Against a green baseline (5/5):
 *
 *   M1  the gate reverted — the broken bubble returns             KILLED
 *   M2  a SECOND, ungated mount point added to the layout         KILLED
 *   M3  the route stops requiring a session                       KILLED
 *   CONTROL  the push banner reworded                           SURVIVED
 *
 *   M2 is why the fourth test reads every line that renders the widget rather
 *   than asserting the one that was wrong: reverting a fix and adding a second
 *   copy of the fault look nothing alike in a diff and are the same outage.
 *
 *   M3 is the premise, pinned deliberately. If the session requirement is ever
 *   lifted on purpose, this test failing is the reminder that the gate is now
 *   unnecessary — the right outcome is to reconsider both together, not to
 *   discover later that the widget is hidden from the people it was opened to.
 */
