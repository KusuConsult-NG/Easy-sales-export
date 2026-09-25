"use client";

/**
 * Account deletion — the user's right to erasure, made exercisable.
 *
 * WHY THIS EXISTS
 * ---------------
 * `deleteUserAccountAction` has been written and correct for some time: it
 * scrubs every PII field, marks KYC records and seller verification, and keeps
 * the UID so ledgers and orders do not lose their foreign keys. It had **no
 * caller**, so the right existed in the codebase and not for any actual person.
 *
 *   #916 THIS PARAGRAPH SAID THE WALLET WAS DELETED. IT IS NOT.
 *
 *   #300 removed that delete entirely — "the wallet is marked, never dropped",
 *   in _deleteUserAccountAction's own words. The sentence above was written
 *   before that and kept the old behaviour, which is the smaller half of what
 *   this component was claiming and the easier half to notice.
 *
 * That gap matters more than it did last week. This platform's user export sat
 * in a public repository for 52 days, and the people in it may reasonably want
 * their accounts gone.
 *
 * WHY THE CONFIRMATION IS TYPED, NOT A CHECKBOX
 * ---------------------------------------------
 * The account cannot be un-deleted from any screen, and every personal field
 * leaves the row it is read from, so the person disappears from the platform.
 * A typed confirmation is the standard for that and is worth the friction.
 *
 *   #916 AND IT IS NOT "GENUINELY DESTROYED", WHICH IS WHAT THIS SAID.
 *
 *   Two owner decisions, both deliberate, both recorded in lib/user-erasure:
 *
 *     #530  "the users profile should still be saved even after they delete
 *            their profile so admin can use it for audit incase of fraud etc."
 *            A full profile copy (credentials excluded by stripSecrets) is
 *            written to COLLECTIONS.ERASURE_RETENTION with
 *            `basis: "fraud_prevention"`, server-only under RLS with no
 *            policies.
 *
 *     #292  Nothing is deleted on Cloudinary or anywhere else. MEASURED: no
 *            destroy call exists in this codebase — every reference to
 *            api.cloudinary.com is an /upload. So the ID scan, passport photo
 *            and proof of address survive, publicly readable with no expiry,
 *            and the retention record keeps the links.
 *
 *   The retention is a defensible position: it has a named lawful basis, a
 *   scope, and no screen that reads it. TELLING THE PERSON THE OPPOSITE IS NOT.
 *   The copy below used to promise that their identity documents were
 *   permanently removed and that "support cannot restore them afterwards", when
 *   a copy is kept precisely so an admin can use it. That is the half worth
 *   fixing, and the fix is the wording — not the retention, which is the
 *   owner's call and is left exactly as it is.
 *
 * WHAT THE SERVER STILL DECIDES
 * -----------------------------
 * Everything. The action refuses while the account holds a wallet balance,
 * cooperative savings, a locked withdrawal, an outstanding loan, or a live
 * escrow — and returns a message naming what is blocking. This component
 * displays that message rather than inventing its own, so the reason a person
 * sees is the reason the server actually applied.
 */

import { useState } from "react";
import { signOut } from "next-auth/react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { deleteUserAccountAction } from "@/app/actions/user";
import { useToast } from "@/contexts/ToastContext";

const CONFIRM_PHRASE = "DELETE MY ACCOUNT";

export default function DeleteAccountSection() {
    const { showToast } = useToast();
    const [open, setOpen] = useState(false);
    const [confirmation, setConfirmation] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [blocked, setBlocked] = useState<string | null>(null);

    async function handleDelete() {
        if (confirmation.trim() !== CONFIRM_PHRASE) {
            return showToast(`Type ${CONFIRM_PHRASE} to confirm`, "error");
        }

        setDeleting(true);
        setBlocked(null);
        try {
            const res: any = await deleteUserAccountAction();

            if (res?.success) {
                showToast("Your account has been deleted", "success");
                // Sign out rather than leaving a session pointing at a redacted
                // record — every subsequent request would load "Redacted User".
                setTimeout(() => signOut({ callbackUrl: "/" }), 1500);
            } else {
                // The server names what is outstanding. Shown verbatim: a
                // generic "could not delete" would leave someone unable to act.
                setBlocked(res?.error || "Your account could not be deleted.");
            }
        } catch {
            setBlocked("Your account could not be deleted. Please contact support.");
        } finally {
            setDeleting(false);
        }
    }

    return (
        <section className="mt-10 rounded-xl border border-red-200 bg-red-50/50 p-6">
            <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                <div className="flex-1">
                    <h2 className="text-lg font-bold text-slate-900">Delete my account</h2>
                    <p className="mt-1 text-sm text-slate-600">
                        Your name, email, phone number, address, bank details and identity
                        numbers are removed from your account. You will no longer appear on any
                        screen, search or report on this platform, and you cannot undo this
                        yourself.
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                        Your past orders and transactions stay on record without your personal
                        details, so other people&apos;s receipts and ledgers remain correct.
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                        So that you know exactly what is kept: a copy of your profile is held in
                        a private record that our fraud team can consult, and files you already
                        uploaded — such as an ID scan or passport photograph — are not deleted
                        from the service that stores them. Your password and any two-factor
                        codes are never kept. To ask about the retained copy, contact{" "}
                        <a href="mailto:info@easysalesexport.com" className="font-semibold underline">
                            info@easysalesexport.com
                        </a>.
                    </p>

                    {blocked && (
                        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                            {blocked}
                        </div>
                    )}

                    {!open ? (
                        <button
                            onClick={() => setOpen(true)}
                            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                        >
                            <Trash2 className="h-4 w-4" />
                            Delete my account
                        </button>
                    ) : (
                        <div className="mt-4 space-y-3">
                            <label htmlFor="confirm-delete" className="block text-sm font-semibold text-slate-700">
                                Type <span className="font-mono">{CONFIRM_PHRASE}</span> to confirm
                            </label>
                            <input
                                id="confirm-delete"
                                value={confirmation}
                                onChange={(e) => setConfirmation(e.target.value)}
                                placeholder={CONFIRM_PHRASE}
                                className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                autoComplete="off"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setOpen(false); setConfirmation(""); setBlocked(null); }}
                                    className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={deleting || confirmation.trim() !== CONFIRM_PHRASE}
                                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                                >
                                    {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Permanently delete
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
