import { redirect } from "next/navigation";

/**
 * /admin/withdrawals is a legacy alias.
 * The canonical page lives at /admin/wave/withdrawals.
 */
export default function AdminWithdrawalsRedirectPage() {
    redirect("/admin/wave/withdrawals");
}
