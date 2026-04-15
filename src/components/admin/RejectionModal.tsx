"use client";

import { useState } from "react";
import { XCircle, Loader2, AlertTriangle } from "lucide-react";
import Modal from "@/components/ui/Modal";

interface RejectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => Promise<void> | void;
    title?: string;
    description?: string;
    isProcessing?: boolean;
}

export default function RejectionModal({
    isOpen,
    onClose,
    onConfirm,
    title = "Reject Application",
    description = "Please provide a reason for rejection. This will be communicated to the applicant.",
    isProcessing = false,
}: RejectionModalProps) {
    const [reason, setReason] = useState("");
    const [localProcessing, setLocalProcessing] = useState(false);

    const isLoading = isProcessing || localProcessing;
    const minLength = 10;
    const maxLength = 500;
    const isValid = reason.trim().length >= minLength;

    async function handleConfirm() {
        if (!isValid || isLoading) return;
        setLocalProcessing(true);
        try {
            await onConfirm(reason.trim());
            setReason("");
        } finally {
            setLocalProcessing(false);
        }
    };

    function handleClose() {
        if (!isLoading) {
            setReason("");
            onClose();
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title={title}>
            <div className="space-y-5">
                {/* Warning banner */}
                <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">{description}</p>
                </div>

                {/* Reason textarea */}
                <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Rejection Reason <span className="text-red-500">*</span>
                    </label>
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Enter the reason for rejection..."
                        rows={4}
                        maxLength={maxLength}
                        disabled={isLoading}
                        className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none placeholder:text-slate-400 disabled:opacity-50"
                    />
                    <div className="flex justify-between mt-1.5">
                        <span className={`text-xs ${reason.trim().length < minLength && reason.length > 0 ? "text-red-500" : "text-slate-400"}`}>
                            {reason.trim().length < minLength && reason.length > 0
                                ? `Minimum ${minLength} characters required`
                                : `Minimum ${minLength} characters`}
                        </span>
                        <span className={`text-xs ${reason.length > maxLength * 0.9 ? "text-orange-500" : "text-slate-400"}`}>
                            {reason.length}/{maxLength}
                        </span>
                    </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-3 pt-2 border-t border-slate-200">
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isLoading}
                        className="flex-1 px-4 py-2.5 text-slate-600 bg-slate-100 hover:bg-slate-200 font-semibold rounded-xl transition disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={!isValid || isLoading}
                        className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isLoading ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                        ) : (
                            <><XCircle className="w-4 h-4" /> Confirm Rejection</>
                        )}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
