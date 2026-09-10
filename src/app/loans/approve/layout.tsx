import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 *   #617 THE BUSINESS LOAN QUEUE IS AN ADMIN SCREEN AND NOW LOOKS LIKE ONE.
 *
 *        It is listed in AdminSidebar as "Business Loans" and lives at
 *        /loans/approve, outside /admin. In Next.js the layout comes from the
 *        URL rather than from the link that was clicked, so it fell through to
 *        the root layout: an administrator following an admin link landed on a
 *        screen wearing the MEMBER chrome — Messages, profile, log out, their
 *        own email — with no way back into the portal but the back button.
 *
 *        #384 decided deliberately to leave the path where it is, and that
 *        decision stands: /loans/apply beside it is a MEMBER screen, so this is
 *        a genuinely mixed branch of the tree and the layout belongs on the one
 *        route rather than on /loans. What #384 could not have known is that
 *        position picks the layout, so the link it added made the screen
 *        reachable and left it dressed as somebody else's.
 *
 *        The guard travels with the chrome — AdminShell refuses everyone
 *        `isAdmin` rejects — so this is not merely cosmetic: the page is now
 *        protected by the same check as every other admin screen, in addition to
 *        whatever it does for itself.
 */
export default function BusinessLoanApprovalLayout({ children }: { children: React.ReactNode }) {
    return <AdminShell>{children}</AdminShell>;
}
