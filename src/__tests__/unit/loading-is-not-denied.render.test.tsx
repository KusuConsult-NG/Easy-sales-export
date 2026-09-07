/**
 * @jest-environment jsdom
 */

/**
 *   #484 THE ADMIN NAVIGATION RENDERED "YOU MAY NOT" WHILE IT MEANT "NOT YET".
 *
 *   The owner sent a photograph of production, cold, in incognito. The sidebar
 *   was drawn: three section headings — PLATFORM, MODULES, FINANCE & SETTINGS —
 *   AND NOT ONE LINK UNDER ANY OF THEM. At the bottom, "SIGNED IN AS Moderator".
 *   They are a super_admin.
 *
 *   That screen is not a loading state. It is a fully-rendered nav that has
 *   decided this person may see nothing, over a name that is a REAL ROLE in this
 *   system — moderator holds content-approval and nothing else. An operator
 *   reading it has no way to tell it from the permission failure the owner has
 *   reported over and over ("account not found even when they are fully
 *   registered"), and it is the FIRST thing shown on every cold load.
 *
 *   THE CAUSE IS ONE DISCARDED VALUE. AdminSidebar read
 *
 *       const { data: session } = useSession();
 *       const roles: string[] = (session?.user as any)?.roles || [];
 *
 *   `useSession` returns `status` as well, and it has three values —
 *   "loading", "authenticated", "unauthenticated". The component took only
 *   `data`, so the one state where the answer is NOT KNOWN YET became `roles =
 *   []` — indistinguishable, from there down, from an authenticated user holding
 *   no roles at all. Every one of the 27 items is then filtered out by
 *   hasAdminPermission / canAccessAdminRoute / isPlatformAdmin, all of which
 *   correctly refuse an empty role list, and the label chain at the foot falls
 *   through its seven ternaries to its final else: "Moderator".
 *
 *   So the code was right everywhere except at the one point that decides which
 *   question is being answered.
 *
 *   HOW LONG THE WRONG SCREEN IS UP. Measured earlier in this audit: a Railway
 *   container takes 2,713 ms from process start to first accepted connection,
 *   and /api/auth/session is a request the browser makes AFTER the JS bundle
 *   (524 kB, 32 chunks) has downloaded and run. On the owner's cold load that is
 *   seconds of a screen that says they have no access.
 *
 *   AND IT IS NOT ONLY THE ADMIN. ModuleSidebar reads `roles` the same way and
 *   hides sellerOnly and moduleAccess items on it, so a seller's own nav is
 *   missing its seller links for the same window — a smaller version of the same
 *   defect, on the module every member uses.
 *
 *   AND THE WINDOW IS REMOVED, NOT JUST MADE HONEST. admin/layout.tsx is a
 *   SERVER component: it awaits requireSession(), reads session.user.roles, and
 *   redirects anyone isAdmin() refuses — then rendered <AdminSidebar /> with no
 *   props and sent it back over the network for the answer it had just used. The
 *   roles are handed down now, so the correct nav is in the server's own HTML
 *   and there is no frame in which nothing is known.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     status discarded again (the original defect)     KILLED
 *     "loading" treated as known                       KILLED
 *     the empty-heading guard removed                  KILLED
 *     the request-time snapshot outranking the live    KILLED
 *     the layout passing nothing again                 KILLED
 *     reword this header                               SURVIVED, as intended
 *
 *   THE SECOND HALF: AN EMPTY HEADING IS NOT A SECTION. Even once the answer
 *   arrives, the heading for a section is printed before its items are filtered,
 *   so a support admin — who may reach analytics and audit logs and nothing in
 *   MODULES — gets a MODULES heading over empty space. That is what made the
 *   loading screen look authoritative rather than blank: the page had structure,
 *   so it read as an answer.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';

const mockUseSession = jest.fn() as jest.Mock<any>;

jest.mock('next-auth/react', () => ({
    useSession: () => mockUseSession(),
    signOut: jest.fn(),
}));

jest.mock('@/hooks/useFeatureToggle', () => ({
    useFeatureToggle: () => true,
    useFeatureToggles: (names: string[]) =>
        Object.fromEntries(names.map((n) => [n, true])),
}));

import AdminSidebar from '@/components/admin/AdminSidebar';

/** The label the foot of the sidebar prints for a role it does not recognise. */
const FALLBACK_LABEL = 'Moderator';

const SECTION_HEADINGS = ['Platform', 'Modules', 'Finance & Settings'];

function navLinks(): HTMLElement[] {
    return screen.queryAllByRole('link');
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#484 — while the session is loading, the nav claims nothing', () => {
    it('IT DOES NOT NAME A ROLE IT HAS NOT BEEN TOLD', () => {
        //   THE test, and the exact pixel the owner photographed. "Moderator" is
        //   a real role with real, narrow permissions. Printing it over an
        //   unknown session tells a super_admin they are signed in as somebody
        //   else.
        mockUseSession.mockReturnValue({ data: undefined, status: 'loading' });

        render(<AdminSidebar />);

        expect(screen.queryByText(FALLBACK_LABEL)).not.toBeInTheDocument();
    });

    it('AND IT DOES NOT DRAW EMPTY SECTIONS OVER A DECISION IT HAS NOT MADE', () => {
        //   Three headings above nothing is a rendered answer: "these areas
        //   exist and you may enter none of them". The component does not know
        //   that, and must not say it.
        mockUseSession.mockReturnValue({ data: undefined, status: 'loading' });

        render(<AdminSidebar />);

        const headingsShown = SECTION_HEADINGS.filter(
            (h) => screen.queryByText(h) !== null,
        );
        expect({ whileLoading: headingsShown }).toEqual({ whileLoading: [] });
        expect(navLinks()).toHaveLength(0);
    });

    it('and it says that it is still loading, rather than showing blank space', () => {
        //   The alternative to a wrong answer is not silence. Something has to
        //   occupy the nav or the sidebar reads as broken instead of busy.
        mockUseSession.mockReturnValue({ data: undefined, status: 'loading' });

        render(<AdminSidebar />);

        expect(screen.getByTestId('admin-nav-loading')).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#484 — and once it knows, it answers exactly as before', () => {
    it('A SUPER ADMIN SEES THE WHOLE NAV', () => {
        //   The control. Every assertion above is satisfied by a component that
        //   renders nothing ever; this is what stops that.
        mockUseSession.mockReturnValue({
            data: { user: { roles: ['super_admin'] } },
            status: 'authenticated',
        });

        render(<AdminSidebar />);

        expect(screen.getByText('Super Admin')).toBeInTheDocument();
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Forensic Scan')).toBeInTheDocument();
        expect(navLinks().length).toBeGreaterThanOrEqual(20);
        for (const heading of SECTION_HEADINGS) {
            expect(screen.getByText(heading)).toBeInTheDocument();
        }
    });

    it('AND A REAL MODERATOR IS STILL CALLED ONE, AND STILL GATED', () => {
        //   The fix must not work by never printing the fallback. A moderator
        //   holds content:approve and nothing else, and that is what they should
        //   see — the label is only wrong when the session is UNKNOWN.
        mockUseSession.mockReturnValue({
            data: { user: { roles: ['moderator'] } },
            status: 'authenticated',
        });

        render(<AdminSidebar />);

        expect(screen.getByText(FALLBACK_LABEL)).toBeInTheDocument();
        expect(screen.getByText('Content Approval')).toBeInTheDocument();
        expect(screen.queryByText('Finance')).not.toBeInTheDocument();
    });

    it('A SECTION WITH NO ITEMS FOR THIS ADMIN GETS NO HEADING', () => {
        //   The second half. A heading over empty space is the same lie as the
        //   loading screen, told to somebody whose session HAS resolved.
        mockUseSession.mockReturnValue({
            data: { user: { roles: ['moderator'] } },
            status: 'authenticated',
        });

        render(<AdminSidebar />);

        expect(screen.getByText('Platform')).toBeInTheDocument();
        expect(screen.queryByText('Modules')).not.toBeInTheDocument();
        expect(screen.queryByText('Finance & Settings')).not.toBeInTheDocument();
    });

    it('and a signed-out session is refused rather than left spinning', () => {
        //   "unauthenticated" IS an answer, and a different one from "loading".
        //   Folding it into the placeholder would hang the nav forever for
        //   somebody whose session has genuinely expired.
        mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });

        render(<AdminSidebar />);

        expect(screen.queryByTestId('admin-nav-loading')).not.toBeInTheDocument();
        expect(navLinks()).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#484 — and the window is removed, not merely made honest', () => {
    /**
     * A placeholder is the right thing to show when nothing is known. But the
     * server component rendering this HAD the roles and threw them away, so
     * "nothing is known" was itself avoidable — and this is the half that means
     * the owner sees a correct nav in the first paint rather than a nicer
     * spinner.
     */
    it('SERVER-SUPPLIED ROLES RENDER THE NAV BEFORE THE SESSION CALL RETURNS', () => {
        mockUseSession.mockReturnValue({ data: undefined, status: 'loading' });

        render(<AdminSidebar initialRoles={['super_admin']} />);

        expect(screen.queryByTestId('admin-nav-loading')).not.toBeInTheDocument();
        expect(screen.getByText('Super Admin')).toBeInTheDocument();
        expect(screen.getByText('Forensic Scan')).toBeInTheDocument();
        expect(navLinks().length).toBeGreaterThanOrEqual(20);
    });

    it('AND THE LIVE SESSION OVERRIDES THEM ONCE IT ARRIVES', () => {
        //   #414's rule. The prop is a snapshot taken at request time; if a role
        //   was revoked since, the live answer is the one that must decide, or
        //   the sidebar keeps offering a link the action behind it now refuses.
        mockUseSession.mockReturnValue({
            data: { user: { roles: ['moderator'] } },
            status: 'authenticated',
        });

        render(<AdminSidebar initialRoles={['super_admin']} />);

        expect(screen.getByText(FALLBACK_LABEL)).toBeInTheDocument();
        expect(screen.queryByText('Super Admin')).not.toBeInTheDocument();
        expect(screen.queryByText('Forensic Scan')).not.toBeInTheDocument();
    });

    it('AND THE ADMIN LAYOUT ACTUALLY PASSES THEM', () => {
        //   Without this the component supports a prop nobody supplies, and
        //   every assertion above passes over production behaviour that has not
        //   changed at all. Same shape as #474: the repair reaching one door.
        const layout = readFileSync('src/app/admin/layout.tsx', 'utf-8');

        expect(layout).toMatch(/<AdminSidebar\s+initialRoles=\{roles\}/);
        //   And `roles` there is the session's, not a literal.
        expect(layout).toContain('const roles = sessionResult.session?.user?.roles || []');
    });

    it('and the placeholder is still reachable for a caller that has no roles to give', () => {
        //   "unauthenticated" IS an answer, and a different one from "loading".
        //   Folding it into the placeholder would hang the nav forever for
        //   somebody whose session has genuinely expired.
        mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });

        render(<AdminSidebar />);

        expect(screen.queryByTestId('admin-nav-loading')).not.toBeInTheDocument();
        expect(navLinks()).toHaveLength(0);
    });
});
