/**
 * @jest-environment node
 */

/**
 *   #634 A NOTIFICATION ADDRESSED TO YOU WAS HIDDEN FROM YOU.
 *
 *   Found by following #633 one module along. `notification-filter.ts` was on
 *   the recorded list of narrow hand-written admin gates, and it held TWO
 *   copies of
 *
 *       r === "admin" || r === "super_admin" || r === "academy_admin"
 *
 *   under a comment reading "Admins always see everything" — three of this
 *   platform's ten admin roles. Reading what the other seven were being dropped
 *   BY is how the real finding turned up, and it was not about admins at all.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 *   isNotificationVisible(type, serviceRegistrations, roles) decided whether a
 *   member could see one of their own notifications:
 *
 *       a module-specific type is shown only if the member holds an
 *       approved / active / paid registration for that module
 *
 *   Four places asked it — the header bell, the notifications screen, that
 *   screen's unread tally, and getMyUnreadNotificationCount behind the nav
 *   badge. So a hidden notification was hidden everywhere at once, including
 *   from the count that would have hinted it existed.
 *
 * ── WHY IT COULD ONLY EVER SUBTRACT ─────────────────────────────────────────
 *
 *   Every notification in this codebase is written TO ONE userId, by the code
 *   that knows why that person should receive it. The sweep at the foot of this
 *   file counts the module-typed writes and reads back who each is addressed
 *   to: twenty-five of them, every one to a party of the transaction it
 *   describes — buyerId, sellerId, otherPartyId, initiatorId, respondentId,
 *   booking.userId. NOT ONE IS A BROADCAST.
 *
 *   A filter over a set with no wrong recipients in it has nothing correct to
 *   remove. It removed these:
 *
 *     an export booking      createBookingAction requires a session and nothing
 *                            else. Anybody may book a slot; the confirmation or
 *                            cancellation is typed "export" and needed an
 *                            APPROVED export registration to be seen. Precisely
 *                            the defect the comment beside that notification
 *                            cites #311 for preventing — "a decision that
 *                            reaches nobody" — one step further down.
 *     a marketplace escrow   "Payment Confirmed", "Escrow Funded", "Funds
 *                            Released" need `marketplace` or `farmNation`. A
 *                            seller whose verification is still `pending`, or
 *                            who was `suspended` mid-transaction, holds neither
 *                            — and is the person most in need of hearing that
 *                            money moved.
 *     a dispute              the same, for "A dispute has been opened against
 *                            you". A respondent who cannot see it cannot answer
 *                            it, and the dispute resolves without them.
 *     a land reservation     `land` needs farmNation approved/active/paid, and
 *                            paying for Farm Nation writes `status: "pending"`.
 *                            The entire wait for approval was silent.
 *
 *   AND THE BADGES AGREED ABOUT THE WRONG NUMBER. #416 found the bell and the
 *   nav badge disagreeing and made both apply this filter. They stopped
 *   disagreeing — on zero. A buyer with five unread escrow rows saw no count,
 *   opened the panel, and read "No notifications yet".
 *
 * ── THE FIX, AND THE HALF THAT WAS SOUND ────────────────────────────────────
 *
 *   The predicate is gone. A notification written to you is shown to you.
 *
 *   The tabs are kept, because that part of the original feature was real: ten
 *   module tabs over an account with four notifications is noise. They are
 *   drawn from the types actually in the inbox now rather than from
 *   subscriptions, which were a poor proxy in both directions — an empty WAVE
 *   tab for a subscriber with no WAVE mail, and no tab at all over a buyer's
 *   escrow rows. And the tab-to-type mapping, which existed twice (once to
 *   decide which tabs to draw, once in a hand-written if-chain deciding what
 *   each showed, already disagreeing about `land` and silent about `escrow`),
 *   is one table both sides ask.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import {
    FILTER_TAB_TYPES,
    ALWAYS_VISIBLE_TABS,
    getVisibleFilterTabs,
    notificationMatchesTab,
} from '@/lib/notification-filter';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full) && !/\.d\.ts$/.test(full)) out.push(full);
    }
    return out;
}

/**
 * Comments removed, LINES KEPT.
 *
 * A block comment collapsed to nothing shifts every line after it, and the
 * sweep below reports line numbers that a person then opens. #632's lesson
 * about an extraction that silently stopped describing the file.
 */
const strip = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (l.trim().startsWith('//') ? '' : l)).join('\n');

const APP_FILES = walk(join(ROOT, 'src'))
    .map((f) => relative(ROOT, f))
    .filter((f) => !f.includes('__tests__') && !f.includes('/testing/'));

const BODIES = new Map(APP_FILES.map((f) => [f, strip(readFileSync(join(ROOT, f), 'utf8'))]));

/** The module-specific notification types — the ones the filter used to gate. */
const MODULE_TYPES = [
    'wave', 'academy', 'cooperative', 'loan',
    'farm_nation', 'land', 'escrow', 'dispute', 'export', 'event',
];

const WRITE_CALL =
    /(?:create(?:Bulk)?Notifications?(?:Action)?|_writeNotification)\s*\(/g;

interface Write { file: string; line: number; type: string; to: string }

/** Every write of a module-typed notification, with the id it is addressed to. */
function moduleTypedWrites(): Write[] {
    const out: Write[] = [];
    for (const file of APP_FILES) {
        const src = BODIES.get(file)!;
        WRITE_CALL.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = WRITE_CALL.exec(src))) {
            const slice = src.slice(m.index, m.index + 700);
            const type = /\btype:\s*"([a-z_]+)"/.exec(slice);
            if (!type || !MODULE_TYPES.includes(type[1])) continue;
            const to = /\buserId:\s*([^,\n]+)/.exec(slice);
            out.push({
                file,
                line: src.slice(0, m.index).split('\n').length,
                type: type[1],
                to: (to ? to[1] : '(no userId in the payload)').trim(),
            });
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#634 — the sweep, checked against answers known independently', () => {
    /*
     *   THE INSTRUMENT FIRST. The claim "not one of these is a broadcast" is
     *   this finding's whole justification, and it rests on a regex. A sweep
     *   believed without being checked is how one wrong reading becomes
     *   twenty-five wrong conclusions.
     */
    it('IT FINDS THE WRITES AT THE LINES THEY ARE ACTUALLY ON', () => {
        const writes = moduleTypedWrites();
        const at = (file: string, line: number) =>
            writes.find((w) => w.file === file && w.line === line);

        //   Three known by opening the files. The line numbers matter: they are
        //   what makes this a measurement of THIS repository rather than of a
        //   regex's opinion.
        expect(at('src/app/actions/marketplace/_escrow_lifecycle.ts', 107))
            .toMatchObject({ type: 'escrow', to: 'data.buyerId' });
        expect(at('src/lib/marketplace-notifications.ts', 373))
            .toMatchObject({ type: 'escrow', to: 'buyerId' });
        expect(at('src/app/actions/export-booking.ts', 435))
            .toMatchObject({ type: 'export', to: 'booking.userId' });
    });

    it('AND IT DOES NOT COUNT A `type:` THAT IS NOT A NOTIFICATION', () => {
        /*
         *   The fault that would inflate this in the other direction. `type:
         *   "export"` also appears as a PRICING TIER in _mp_products and as an
         *   approval-queue row in admin-content, and a looser sweep — one
         *   grepping for the type rather than for a write call — reports both.
         *   The first draft of this did.
         */
        const files = new Set(moduleTypedWrites().map((w) => w.file));
        expect(files.has('src/app/actions/marketplace/_mp_products.ts')).toBe(false);
        expect(files.has('src/app/actions/admin-content.ts')).toBe(false);

        //   …and those files really do contain the string, or this proves nothing.
        expect(BODIES.get('src/app/actions/marketplace/_mp_products.ts')).toContain('type: "export"');
        expect(BODIES.get('src/app/actions/admin-content.ts')).toContain('type: "land"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#634 — every module notification is addressed to somebody', () => {
    it('THERE IS NO BROADCAST OF A MODULE-TYPED NOTIFICATION', () => {
        /*
         *   The premise of removing the filter, stated as something that can go
         *   stale. If someone later writes a module-typed notification to a
         *   crowd rather than to a party, this fails — and that is the moment
         *   to think again, rather than after members start seeing other
         *   people's business in their panel.
         */
        const writes = moduleTypedWrites();
        expect(writes.length).toBeGreaterThanOrEqual(25);

        const unaddressed = writes.filter((w) => !/^[\w.]+$/.test(w.to));
        expect({ unaddressed }).toEqual({ unaddressed: [] });

        //   And each id names a party of the thing being notified about, not a
        //   role or a query. Read as the set of distinct recipient expressions,
        //   so a new kind of recipient shows up here by name.
        const recipients = [...new Set(writes.map((w) => w.to.replace(/^\w+\./, '')))].sort();
        expect(recipients).toEqual([
            'buyerId', 'initiatorId', 'otherPartyId', 'respondentId', 'sellerId', 'userId',
        ]);
    });

    it('AND NO READER SUBTRACTS ANYTHING FROM WHAT WAS ADDRESSED', () => {
        //   The fix itself. Pinned as an absence across the whole application,
        //   because the rule is easy to reintroduce under another name in any
        //   one of the four places that used to ask it.
        const holders = APP_FILES.filter((f) =>
            /isNotificationVisible|MODULE_TYPE_MAP/.test(BODIES.get(f)!));
        expect({ holders }).toEqual({ holders: [] });
    });

    it('AND THE FOUR READERS STILL READ — the other half of "no filter"', () => {
        /*
         *   "Nobody filters" is also satisfied by nobody showing anything. Each
         *   of the four places that used to filter is asserted to still be
         *   counting or listing the member's rows.
         */
        const panel = BODIES.get('src/components/layout/NotificationCenter.tsx')!;
        expect(panel).toMatch(/const unreadCount = notifications\.filter\(\(n\) => !n\.read\)\.length;/);
        expect(panel).toMatch(/getMyNotifications\(NOTIFICATION_BADGE_WINDOW\)/);

        const screen = BODIES.get('src/app/dashboard/notifications/NotificationsClient.tsx')!;
        expect(screen).toMatch(/const unreadCount = notifications\.filter\(n => !n\.read\)\.length;/);

        /*
         *   THE WHOLE PREDICATE, NOT A LINE INSIDE IT.
         *
         *   This asserted that `return notificationMatchesTab(n.type, filter);`
         *   APPEARS in the screen, and a mutant that put the old subscription
         *   gate back — `if (n.type === "escrow") return false;` on the line
         *   above it — survived. The line was still there; it had just stopped
         *   being the whole rule.
         *
         *   #629's lesson in a second costume: mentioning a rule is not using
         *   it, and using it is not using ONLY it. Read as a body bounded by
         *   its own braces, so anything added inside fails here.
         */
        const from = screen.indexOf('const filtered = notifications.filter(n => {');
        expect(from).toBeGreaterThan(-1);
        const body = screen.slice(from, screen.indexOf('});', from));
        expect(body.split('\n').map((l) => l.trim()).filter(Boolean)).toEqual([
            'const filtered = notifications.filter(n => {',
            'if (filter === "unread") return !n.read;',
            'return notificationMatchesTab(n.type, filter);',
        ]);

        const action = BODIES.get('src/app/actions/my-data.ts')!;
        expect(action).toMatch(/return snap\.docs\.length;/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#634 — the tabs, drawn from the inbox rather than from a proxy', () => {
    it('A TAB IS DRAWN ONLY WHEN SOMETHING IS BEHIND IT', () => {
        //   And the screen asks the question of its notifications, not of the
        //   session — the substitution that was the whole defect one level up.
        expect(BODIES.get('src/app/dashboard/notifications/NotificationsClient.tsx'))
            .toMatch(/getVisibleFilterTabs\(notifications\.map\(n => n\.type\)\)/);

        expect(getVisibleFilterTabs([])).toEqual([...ALWAYS_VISIBLE_TABS]);
        expect(getVisibleFilterTabs(['escrow'])).toEqual(['all', 'unread', 'escrow']);
        expect(getVisibleFilterTabs(['land'])).toEqual(['all', 'unread', 'farm_nation']);
    });

    it('AND EVERY TAB IT DRAWS SHOWS THE ROW THAT DREW IT', () => {
        /*
         *   The property the two hand-written copies could not hold between
         *   them: the old chain folded `land` into Farm Nation while the old
         *   tab list keyed Farm Nation on a farmNation REGISTRATION, so the two
         *   were not answering the same question at all.
         *
         *   Asserted over every type any tab collects, so a table edited on one
         *   side only fails here.
         */
        for (const [tab, types] of Object.entries(FILTER_TAB_TYPES)) {
            for (const type of types) {
                expect({ tab, type, drawn: getVisibleFilterTabs([type]).includes(tab) })
                    .toEqual({ tab, type, drawn: true });
                expect({ tab, type, shown: notificationMatchesTab(type, tab) })
                    .toEqual({ tab, type, shown: true });
            }
        }
    });

    it('AND A TAB DOES NOT COLLECT SOMEBODY ELSE\'S ROWS', () => {
        //   The other direction — otherwise a table mapping every tab to every
        //   type would pass the test above.
        expect(notificationMatchesTab('escrow', 'dispute')).toBe(false);
        expect(notificationMatchesTab('wave', 'academy')).toBe(false);
        expect(notificationMatchesTab('land', 'export')).toBe(false);
        //   "all" is the absence of a filter, and says so.
        expect(notificationMatchesTab('anything_at_all', 'all')).toBe(true);
    });

    it('AND ESCROW HAS A TAB AT ALL', () => {
        /*
         *   Eighteen of the twenty-five module-typed writes are escrow, and it
         *   was the one type with no tab — reachable only under All, on a screen
         *   whose other nine categories each had one. Pinned to the screen's tab
         *   list as well as to the table, since a tab key nothing draws is not a
         *   tab.
         */
        expect(FILTER_TAB_TYPES.escrow).toBeDefined();
        const screen = BODIES.get('src/app/dashboard/notifications/NotificationsClient.tsx')!;
        expect(screen).toMatch(/\{ key: "escrow",\s*label: "Escrow" \}/);

        //   And the screen draws exactly the keys this module knows about.
        const drawn = [...screen.matchAll(/\{ key: "(\w+)",\s*label:/g)].map((m) => m[1]).sort();
        const known = [...ALWAYS_VISIBLE_TABS, ...Object.keys(FILTER_TAB_TYPES)].sort();
        expect(drawn).toEqual(known);
    });

    it('AND IT NEEDS NEITHER REGISTRATIONS NOR ROLES TO ANSWER', () => {
        //   #633's shape is gone with the filter: there is no admin exemption
        //   left to write out narrowly, because there is nothing to be exempt
        //   from. Asserted on the source, so re-adding a roles parameter fails.
        const filter = BODIES.get('src/lib/notification-filter.ts')!;
        expect(filter).not.toMatch(/roles/);
        expect(filter).not.toMatch(/serviceRegistrations/);
        expect(filter).not.toMatch(/super_admin/);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the bell filters by subscription again             KILLED
 *     THE DEFECT: the screen filters by subscription again           KILLED
 *     THE DEFECT: the badge count filters by subscription again      KILLED
 *     the tab list goes back to reading serviceRegistrations         KILLED
 *     a module-typed notification is written to a crowd              KILLED
 *     the escrow tab is removed from the screen                      KILLED
 *     FILTER_TAB_TYPES drops `land` from the Farm Nation tab         KILLED
 *     notificationMatchesTab matches every tab                       KILLED
 *     the bell stops counting unread at all                          KILLED
 *     the filter module regains a roles exemption                    KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   "The bell stops counting unread at all" is the guard against the cheap way
 *   to pass this file: "nobody filters" is also true of a panel that shows
 *   nothing.
 *
 * ── AND THE CENTRAL ONE SURVIVED FIRST ──────────────────────────────────────
 *
 *   "The screen filters by subscription again" — the defect itself, on the
 *   screen where members actually read their notifications — survived the first
 *   run, and the reason is worth the space.
 *
 *   The assertion was that
 *
 *       return notificationMatchesTab(n.type, filter);
 *
 *   APPEARS in the screen's source. The mutant did not remove it. It added
 *   `if (n.type === "escrow") return false;` on the line above, so the line was
 *   still there and had simply stopped being the whole rule.
 *
 *   #629's lesson wearing a second costume. There it was "mentioning a rule is
 *   not using it"; here it is "using a rule is not using ONLY it" — and a
 *   test that asks whether a line is present cannot tell the difference. The
 *   predicate is read as a body bounded by its own braces now, and asserted
 *   line for line, so anything added inside it fails.
 */
