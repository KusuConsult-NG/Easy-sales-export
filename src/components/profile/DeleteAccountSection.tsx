"use client";

/**
 * Account deletion — the user's right to erasure, made exercisable.
 *
 * WHY THIS EXISTS
 * ---------------
 * `deleteUserAccountAction` has been written and correct for some time: it
 * scrubs every PII field, deletes KYC records, seller verification and the
 * wallet, and keeps the UID so ledgers and orders do not lose their foreign
 * keys. It had **no caller**, so the right existed in the codebase and not for
 * any actual person.
 *
 * That gap matters more than it did last week. This platform's user export sat
 * in a public repository for 52 days, and the people in it may reasonably want
 * their accounts gone.
 *
 * WHY THE CONFIRMATION IS TYPED, NOT A CHECKBOX
 * ---------------------------------------------
 * The deletion is irreversible and the PII is genuinely destroyed — there is no
 * undo and no support path that restores a name once it is redacted. A typed
 * confirmation is the standard for that, and it is worth the friction.
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
                        This permanently removes your name, email, phone number, address, bank
                        details and identity documents. It cannot be undone, and support cannot
                        restore them afterwards.
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                        Your past orders and transactions stay on record without your personal
                        details, so other people&apos;s receipts and ledgers remain correct.
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
