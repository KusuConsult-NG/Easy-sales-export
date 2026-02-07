"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { Users, DollarSign, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import LoadingButton from "@/components/ui/LoadingButton";
import { useToast } from "@/contexts/ToastContext";

type JoinCooperativeState =
    | { error: string; success: false }
    | { error: null; success: true; message: string };

const initialState: JoinCooperativeState = { error: "Initializing...", success: false };

interface JoinCooperativeModalProps {
    isOpen: boolean;
    onClose: () => void;
    cooperativeName: string;
    cooperativeId: string;
}

// Server action wrapper compatible with useActionState
async function joinCooperativeWrapper(
    prevState: JoinCooperativeState,
    formData: FormData
): Promise<JoinCooperativeState> {
    "use server";

    const { auth } = await import("@/lib/auth");
    const { db } = await import("@/lib/firebase");
    const { doc, getDoc, setDoc, updateDoc, increment, serverTimestamp } = await import("firebase/firestore");
    const { COLLECTIONS } = await import("@/lib/types/firestore");

    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in to join a cooperative", success: false };
        }

        const cooperativeId = formData.get("cooperativeId") as string;
        const initialContribution = parseFloat(formData.get("initialContribution") as string) || 0;
        const monthlyTarget = parseFloat(formData.get("monthlyTarget") as string);

        if (!monthlyTarget || monthlyTarget < 1000) {
            return { error: "Monthly target must be at least ₦1,000", success: false };
        }

        const userId = session.user.id;

        // Check if cooperative exists
        const cooperativeRef = doc(db, COLLECTIONS.COOPERATIVES, cooperativeId);
        const cooperativeDoc = await getDoc(cooperativeRef);

        if (!cooperativeDoc.exists()) {
            return { error: "Cooperative not found", success: false };
        }

        // Check if already a member
        const memberRef = doc(db, COLLECTIONS.COOPERATIVES, cooperativeId, "members", userId);
        const memberDoc = await getDoc(memberRef);

        if (memberDoc.exists()) {
            return { error: "You are already a member of this cooperative", success: false };
        }

        // Add user as member
        await setDoc(memberRef, {
            userId,
            balance: initialContribution,
            loanBalance: 0,
            monthlyTarget,
            joinedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        // Update cooperative member count
        await updateDoc(cooperativeRef, {
            memberCount: increment(1),
            totalSavings: increment(initialContribution),
        });

        // Update user's cooperativeId
        await updateDoc(doc(db, COLLECTIONS.USERS, userId), {
            cooperativeId,
            updatedAt: serverTimestamp(),
        });

        return {
            error: null,
            success: true,
            message: "Successfully joined the cooperative!",
        };
    } catch (error: any) {
        console.error("Join cooperative error:", error);
        return { error: "Failed to join cooperative. Please try again.", success: false };
    }
}

export default function JoinCooperativeModal({
    isOpen,
    onClose,
    cooperativeName,
    cooperativeId
}: JoinCooperativeModalProps) {
    const [state, formAction, isPending] = useActionState(joinCooperativeWrapper, initialState);
    const { showToast } = useToast();

    // Handle success/error with toasts
    useEffect(() => {
        if (state.success && !isPending && state.message) {
            showToast(state.message, "success");
            setTimeout(() => {
                onClose();
                window.location.reload();
            }, 1500);
        } else if (state.error && !state.success && state.error !== "Initializing...") {
            showToast(state.error, "error");
        }
    }, [state.success, state.error, isPending, onClose, showToast]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Join Cooperative">
            <form action={formAction} className="space-y-6">
                {/* Hidden cooperativeId field */}
                <input type="hidden" name="cooperativeId" value={cooperativeId} />

                {/* Error Display */}
                {state.error && !state.success && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                        <p className="text-red-300 text-sm">{state.error}</p>
                    </div>
                )}

                {/* Success Display */}
                {state.success && state.message && (
                    <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                        <p className="text-green-300 text-sm font-medium">{state.message}</p>
                    </div>
                )}

                {/* Cooperative Info */}
                <div className="bg-linear-to-br from-primary/10 to-primary/5 rounded-xl p-6 border border-primary/20">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                            <Users className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white">{cooperativeName}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Agricultural Cooperative</p>
                        </div>
                    </div>
                    <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-600" />
                            <span className="text-slate-700 dark:text-slate-300">Earn interest on savings</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-600" />
                            <span className="text-slate-700 dark:text-slate-300">Access to low-interest loans</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-600" />
                            <span className="text-slate-700 dark:text-slate-300">Share profits from collective sales</span>
                        </div>
                    </div>
                </div>

                {/* Initial Contribution */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        <DollarSign className="w-4 h-4 inline mr-2" />
                        Initial Contribution (Optional)
                    </label>
                    <input
                        type="number"
                        name="initialContribution"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        You can make an initial savings contribution when joining. This is optional.
                    </p>
                </div>

                {/* Monthly Target */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Monthly Savings Target (NGN) *
                    </label>
                    <input
                        type="number"
                        name="monthlyTarget"
                        min="1000"
                        step="100"
                        defaultValue="5000"
                        required
                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        Set your personal monthly savings goal (minimum ₦1,000)
                    </p>
                </div>

                {/* Terms Agreement */}
                <div className="flex items-start gap-3">
                    <input
                        type="checkbox"
                        name="agreeToTerms"
                        required
                        className="mt-1 text-primary focus:ring-primary"
                    />
                    <label className="text-sm text-slate-700 dark:text-slate-300">
                        I agree to the cooperative terms and conditions, including the savings requirements and profit-sharing structure
                    </label>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isPending}
                        className="flex-1 px-6 py-3 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <LoadingButton
                        type="submit"
                        loading={isPending}
                        loadingText="Joining..."
                        className="flex-1 px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition"
                    >
                        Join Cooperative
                    </LoadingButton>
                </div>
            </form>
        </Modal>
    );
}
