/**
 *   #617 A SCREEN IN THE ADMIN SIDEBAR THAT DID NOT GET THE ADMIN SIDEBAR.
 *
 *   Reported from the running app: opening Business Loans from the admin portal
 *   showed the global member chrome — Messages, profile, log out, the user's own
 *   email — instead of the admin sidebar.
 *
 *   IN NEXT.JS THE LAYOUT COMES FROM THE URL, NOT FROM THE LINK THAT WAS
 *   CLICKED. `src/app/admin/layout.tsx` draws the admin chrome for everything
 *   under /admin. "Business Loans" is the one entry in that sidebar pointing
 *   somewhere else — /loans/approve — and nothing under src/app/loans had a
 *   layout, so it fell through to the root one. An administrator following an
 *   admin link arrived on a screen dressed as a member's, with no way back into
 *   the portal but the browser's back button.
 *
 *   #384 wired that link and recorded a deliberate decision not to move the
 *   route: "moving a route to fix a missing link is a change with more ways to go
 *   wrong than the one being fixed." That reasoning was sound and is untouched —
 *   /loans/apply beside it is a MEMBER screen, so this really is a mixed branch
 *   and the path should stay. What #384 could not have known is that POSITION
 *   PICKS THE LAYOUT: wiring the link made the screen reachable and left it
 *   wearing somebody else's clothes.
 *
 * ── ONE SHELL, NOT TWO LAYOUTS ──────────────────────────────────────────────
 *
 *   The obvious fix is to copy admin/layout.tsx into loans/approve/. That is two
 *   hand-maintained copies of one contract — the defect this audit keeps finding,
 *   including twice in its own files — and the copy that drifts is the one nobody
 *   looks at. Both layouts render `AdminShell`, which holds the guard, the
 *   sidebar and the column.
 *
 *   THE GUARD TRAVELS WITH THE CHROME, which is the part that is not cosmetic. A
 *   page drawing the admin sidebar has by construction already refused everyone
 *   `isAdmin` rejects, so the two cannot come apart — and /loans/approve is now
 *   covered by that check as well as by whatever it does for itself.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * The same file with its comments removed.
 *
 * An assertion about CODE must not be satisfied — or defeated — by PROSE. The
 * first version of the guard check below failed because the layout's own comment
 * explains what AdminSidebar is, which is #605's cap matching its own
 * documentation, in the other direction.
 */
const code = (rel: string) => read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

/** Every internal href the admin sidebar offers. */
function adminSidebarLinks(): string[] {
    const src = read('src/components/admin/AdminSidebar.tsx');
    return [...src.matchAll(/href:\s*"(\/[^"]*)"/g)].map(m => m[1]);
}

/**
 * The directory whose layout.tsx governs a path, or null when nothing does.
 *
 * Walks upwards exactly as the framework does: the nearest layout above the
 * route wins, and a route with none above it gets the root one.
 */
function governingLayout(routePath: string): string | null {
    const segments = routePath.split('/').filter(Boolean);
    for (let i = segments.length; i >= 0; i--) {
        const dir = join('src/app', ...segments.slice(0, i));
        if (existsSync(join(ROOT, dir, 'layout.tsx'))) return dir;
    }
    return null;
}

/** Does that layout draw the admin chrome? */
function wearsAdminChrome(routePath: string): boolean {
    const dir = governingLayout(routePath);
    if (!dir || dir === 'src/app') return false;
    const src = read(join(dir, 'layout.tsx'));
    return src.includes('AdminShell') || src.includes('AdminSidebar');
}

describe('#617 — every screen the admin sidebar offers wears the admin chrome', () => {
    it('THE SIDEBAR HAS LINKS TO CHECK — and one of them really is outside /admin', () => {
        //   Not a count: the OUTSIDER is the whole subject of this file, and if it
        //   ever moves under /admin the assertions below stop meaning anything
        //   while still passing. Naming it means that change is deliberate.
        const links = adminSidebarLinks();
        expect(links.length).toBeGreaterThan(10);
        expect(links).toContain('/loans/approve');
        expect(links.filter(l => !l.startsWith('/admin'))).toEqual(['/loans/approve']);
    });

    it.each(['/loans/approve'])('%s is governed by a layout that draws the admin chrome', (route) => {
        expect(wearsAdminChrome(route)).toBe(true);
    });

    it('AND SO IS EVERY OTHER LINK IN THAT SIDEBAR', () => {
        const wrong = adminSidebarLinks().filter(l => !wearsAdminChrome(l));
        expect(wrong).toEqual([]);
    });

    it('AND THE CHECK CAN FAIL — a positive control on the layout walk', () => {
        //   Without this, `wearsAdminChrome` returning true for everything would
        //   satisfy every assertion above. A member route must come back false,
        //   and a route with no layout above it must resolve to the root.
        expect(wearsAdminChrome('/dashboard')).toBe(false);
        expect(wearsAdminChrome('/loans/apply')).toBe(false);
        //   /loans/apply is a MEMBER screen sitting beside the admin one, which
        //   is why the layout is on /loans/approve and not on /loans. If somebody
        //   ever moves it up, this fails and says so.
        expect(governingLayout('/loans/apply')).toBe('src/app');
    });
});

describe('#617 — and the chrome is defined once', () => {
    it('BOTH LAYOUTS RENDER THE SAME SHELL', () => {
        expect(read('src/app/admin/layout.tsx')).toContain('<AdminShell>');
        expect(read('src/app/loans/approve/layout.tsx')).toContain('<AdminShell>');
    });

    it('AND NEITHER CARRIES ITS OWN COPY OF THE GUARD', () => {
        //   Two hand-maintained copies of one contract is the defect this audit
        //   keeps finding. The guard belongs with the chrome so they cannot come
        //   apart: a page drawing the admin sidebar has already refused everyone
        //   isAdmin rejects.
        for (const layout of ['src/app/admin/layout.tsx', 'src/app/loans/approve/layout.tsx']) {
            expect(code(layout)).not.toContain('requireSession');
            expect(code(layout)).not.toContain('AdminSidebar');
        }
        const shell = code('src/components/admin/AdminShell.tsx');
        expect(shell).toContain('requireSession');
        expect(shell).toContain('isAdmin(roles)');
        expect(shell).toContain('AdminSidebar');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     /loans/approve layout stops rendering AdminShell               KILLED
 *     wearsAdminChrome: return true for everything                   KILLED
 *     governingLayout: stop walking up (only exact matches)          KILLED
 *     AdminShell: drop the isAdmin redirect                          KILLED
 *     the loans layout imports its own guard back                    KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   ONE ASSERTION FAILED AGAINST CORRECT CODE FIRST, AND THE CAUSE IS WORTH
 *   KEEPING: `not.toContain('AdminSidebar')` matched the layout's own COMMENT
 *   explaining what AdminSidebar is. #605's cap did the same thing in the other
 *   direction, matching its own documentation. An assertion about code has to be
 *   made against code, so the comments are stripped first.
 */
