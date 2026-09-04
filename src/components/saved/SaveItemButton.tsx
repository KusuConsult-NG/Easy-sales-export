"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Heart, Loader2 } from "lucide-react";
import { toggleSavedItemAction, getSavedItemStateAction } from "@/app/actions/saved-items";
import { useToast } from "@/contexts/ToastContext";
import type { SavedItemType } from "@/lib/saved-items";

/**
 * The save control — one component, for both things that can be saved.
 *
 *   #105. The Farm Nation property page had this:
 *
 *       const [isFavorite, setIsFavorite] = useState(false);
 *       ...
 *       <button onClick={() => setIsFavorite(!isFavorite)}>
 *
 *   The heart filled, and the state died with the component. Nothing was sent
 *   anywhere, so reloading the page or coming back to it lost it, and
 *   `favoriteCount` — initialised to 0 on every listing — was moved by nothing.
 *
 *   The marketplace's half of the same feature had no control at all: the
 *   buyer dashboard displayed a "Saved Sellers" count with nowhere in the app
 *   to save a seller from.
 *
 * THREE THINGS THIS DOES THAT THE useState VERSION COULD NOT
 * ----------------------------------------------------------
 *   1. It renders what the SERVER says, both on load and after a click. The
 *      old control asserted its own new state; this one asks. #310's lesson —
 *      a screen that discards the server's answer shows the user a success
 *      that did not happen.
 *   2. A REFUSAL IS SHOWN. A failed toggle puts the icon back and says so,
 *      rather than leaving a filled heart over a save that never landed.
 *   3. Somebody not signed in is sent to sign in, with a callback back to
 *      here, instead of clicking a control that silently cannot work.
 */
export function SaveItemButton({
    itemType,
    targetId,
    variant = "icon",
    className = "",
}: {
    itemType: SavedItemType;
    targetId: string;
    /** "icon" is the bare heart; "labelled" adds the word beside it. */
    variant?: "icon" | "labelled";
    className?: string;
}) {
    const router = useRouter();
    const { status } = useSession();
    const { showToast } = useToast();

    const [saved, setSaved] = useState(false);
    const [busy, setBusy] = useState(false);
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        let live = true;
        async function check() {
            const result = await getSavedItemStateAction(itemType, targetId);
            if (!live) return;
            // A failed check leaves the icon empty AND leaves `checked` false,
            // so the control reads as "not known" rather than as "not saved".
            if (result.success && result.data) setSaved(result.data.saved);
            setChecked(result.success);
        }
        if (status !== "loading") check();
        return () => { live = false; };
    }, [itemType, targetId, status]);

    const onClick = useCallback(async () => {
        if (status === "unauthenticated") {
            router.push(`/auth/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
            return;
        }
        if (busy) return;

        setBusy(true);
        try {
            const result = await toggleSavedItemAction(itemType, targetId);
            if (result.success && result.data) {
                setSaved(result.data.saved);
                setChecked(true);
                showToast(result.data.saved ? "Saved" : "Removed from your saved items", "success");
            } else {
                showToast(result.error || "Could not update your saved items", "error");
            }
        } finally {
            setBusy(false);
        }
    }, [busy, itemType, router, showToast, status, targetId]);

    const label = saved ? "Saved" : "Save";

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy}
            aria-pressed={saved}
            aria-label={label}
            title={checked ? label : "Save"}
            className={`flex items-center gap-2 p-2 rounded-lg transition disabled:opacity-60 ${
                saved
                    ? "bg-red-100 text-red-600"
                    : "bg-slate-100 text-slate-600 hover:text-red-600"
            } ${className}`}
        >
            {busy ? (
                <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
                <Heart className={`w-5 h-5 ${saved ? "fill-current" : ""}`} />
            )}
            {variant === "labelled" && <span className="text-sm font-semibold">{label}</span>}
        </button>
    );
}
