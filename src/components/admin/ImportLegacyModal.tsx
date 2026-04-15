"use client";

import { useState } from "react";
import { Mail, Loader2, CheckCircle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { inviteLegacyMemberAction } from "@/app/actions/admin";

interface ImportLegacyModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function ImportLegacyModal({ isOpen, onClose, onSuccess }: ImportLegacyModalProps) {
    const [formData, setFormData] = useState({
        email: "",
        firstName: "",
    });
    
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSuccess, setIsSuccess] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const result = await inviteLegacyMemberAction(formData);
        
        setIsLoading(false);

        if (result.success) {
            if (result.error) {
                 // Partial success (e.g. invite created, email failed)
                 setError(result.error);
            } else {
                 setIsSuccess(true);
                 onSuccess(); // Refresh the table
            }
        } else {
            setError(result.error || "Failed to invite member.");
        }
    };

    function handleClose() {
        setFormData({
            email: "",
            firstName: "",
        });
        setIsSuccess(false);
        setError(null);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Invite Legacy Member">
            {!isSuccess ? (
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl mb-4">
                        <p className="text-sm text-blue-800">
                            Use this form to invite cooperative members who paid outside the platform. This generates an onboarding link that bypasses the payment step and emails it to them.
                        </p>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm break-all">
                            {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Email Address <span className="text-red-500">*</span></label>
                            <input 
                                type="email" 
                                required
                                value={formData.email} 
                                onChange={(e) => setFormData({...formData, email: e.target.value})}
                                className="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none" 
                                placeholder="member@example.com"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">First Name <span className="text-slate-400 font-normal">(Optional, for personalization)</span></label>
                            <input 
                                type="text" 
                                value={formData.firstName} 
                                onChange={(e) => setFormData({...formData, firstName: e.target.value})}
                                className="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none" 
                                placeholder="e.g. John"
                            />
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-slate-200 mt-6">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="flex-1 px-4 py-2.5 text-slate-600 bg-slate-100 hover:bg-slate-200 font-semibold rounded-xl transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                            Send Invitation
                        </button>
                    </div>
                </form>
            ) : (
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="w-8 h-8 text-emerald-600" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Invitation Sent!</h3>
                    <p className="text-slate-600 mb-6">
                        An email has been sent to <strong>{formData.email}</strong> with their custom onboarding link.
                    </p>

                    <button
                        onClick={handleClose}
                        className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition"
                    >
                        Done
                    </button>
                </div>
            )}
        </Modal>
    );
}
