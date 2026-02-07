"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { Package, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import LoadingButton from "@/components/ui/LoadingButton";
import { useToast } from "@/contexts/ToastContext";
import { updateExportStatusAction } from "@/app/actions/export-status";

type UpdateExportStatusState =
    | { error: string; success: false }
    | { error: null; success: true; message: string };

const initialState: UpdateExportStatusState = { error: "Initializing...", success: false };

type ExportStatus = "pending" | "in_transit" | "delivered" | "completed";

interface StatusUpdateModalProps {
    isOpen: boolean;
    onClose: () => void;
    exportId: string;
    currentStatus: ExportStatus;
}

export default function StatusUpdateModal({
    isOpen,
    onClose,
    exportId,
    currentStatus
}: StatusUpdateModalProps) {
    const [state, formAction, isPending] = useActionState(updateExportStatusAction, initialState);
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

    const statusOptions: { value: ExportStatus; label: string; description: string }[] = [
        { value: "pending", label: "Pending", description: "Order is being prepared" },
        { value: "in_transit", label: "In Transit", description: "Currently being shipped" },
        { value: "delivered", label: "Delivered", description: "Received by buyer" },
        { value: "completed", label: "Completed", description: "Escrow released" },
    ];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Update Export Status">
            <form action={formAction} className="space-y-4">
                {/* Hidden exportId field */}
                <input type="hidden" name="exportId" value={exportId} />

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

                {/* Current Status */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Current Status</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-white capitalize">
                        {currentStatus.replace("_", " ")}
                    </p>
                </div>

                {/* Status Selection */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                        <Package className="w-4 h-4 inline mr-2" />
                        New Status
                    </label>
                    <div className="space-y-2">
                        {statusOptions.map((option) => (
                            <label
                                key={option.value}
                                className={`flex items-start p-4 border-2 rounded-xl cursor-pointer transition ${option.value === currentStatus
                                    ? "border-slate-300 dark:border-slate-600 opacity-50 cursor-not-allowed"
                                    : "border-slate-200 dark:border-slate-700 hover:border-primary"
                                    }`}
                            >
                                <input
                                    type="radio"
                                    name="status"
                                    value={option.value}
                                    disabled={option.value === currentStatus}
                                    required
                                    className="mt-1 text-primary focus:ring-primary"
                                />
                                <div className="ml-3 flex-1">
                                    <p className="font-semibold text-slate-900 dark:text-white">
                                        {option.label}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {option.description}
                                    </p>
                                </div>
                            </label>
                        ))}
                    </div>
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
                        loadingText="Updating..."
                        className="flex-1 px-6 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition"
                    >
                        Update Status
                    </LoadingButton>
                </div>
            </form>
        </Modal>
    );
}
