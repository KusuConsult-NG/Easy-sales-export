import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Everything under /admin wears the admin chrome.
 *
 * The chrome itself — sidebar, guard, content column — lives in AdminShell,
 * because /loans/approve needs the same thing and is not under this path. See
 * that file for why it is one component rather than two layouts.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return <AdminShell>{children}</AdminShell>;
}
