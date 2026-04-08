"use client";

import { useState } from "react";
import { UserPlus, Loader2, Copy, CheckCircle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { importLegacyMemberAction } from "@/app/actions/admin";

interface ImportLegacyModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function ImportLegacyModal({ isOpen, onClose, onSuccess }: ImportLegacyModalProps) {
    const [formData, setFormData] = useState({
        email: "",
        firstName: "",
        lastName: "",
        phone: "",
        membershipTier: "basic" as "basic" | "premium",
        registrationFee: "",
    });
    
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successData, setSuccessData] = useState<{ resetLink: string; uid: string } | null>(null);
    const [copied, setCopied] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        const payload = {
            ...formData,
            registrationFee: formData.registrationFee ? Number(formData.registrationFee) : undefined,
        };

        const result = await importLegacyMemberAction(payload);
        
        setIsLoading(false);

        if (result.success && result.resetLink) {
            setSuccessData({ resetLink: result.resetLink, uid: result.uid! });
            onSuccess(); // Refresh the table
        } else {
            setError(result.error || "Failed to import member.");
        }
    };

    const copyToClipboard = () => {
        if (successData?.resetLink) {
            navigator.clipboard.writeText(successData.resetLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleClose = () => {
        setFormData({
            email: "",
            firstName: "",
            lastName: "",
            phone: "",
            membershipTier: "basic",
            registrationFee: "",
        });
        setSuccessData(null);
        setError(null);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Import Legacy Member">
            {!successData ? (
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl mb-4">
                        <p className="text-sm text-blue-800">
                            Use this form to onboard cooperative members who paid outside the platform. This bypasses the payment step and automatically approves their payment status.
                        </p>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">Email <span className="text-red-500">*</span></label>
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
                            <label className="block text-sm font-medium text-slate-700 mb-1">First Name <span className="text-red-500">*</span></label>
                            <input 
                                type="text" 
                                required
                                value={formData.firstName} 
                                onChange={(e) => setFormData({...formData, firstName: e.target.value})}
                                className="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none" 
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Last Name <span className="text-red-500">*</span></label>
                            <input 
                                type="text" 
                                required
                                value={formData.lastName} 
                                onChange={(e) => setFormData({...formData, lastName: e.target.value})}
                                className="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none" 
                            />
                        </div>

                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">Phone <span className="text-red-500">*</span></label>
                            <input 
                                type="tel" 
                                required
                                value={formData.phone} 
                                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                                className="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none" 
                                placeholder="08012345678"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Membership Tier</label>
                            <select 
                                value={formData.membershipTier}
                                onChange={(e) => setFormData({...formData, membershipTier: e.target.value as "basic" | "premium"})}
                                className="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                            >
                                <option value="basic">Basic (₦10,000)</option>
                                <option value="premium">Premium (₦20,000)</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Actual Fee Paid <span className="text-slate-400 font-normal">(Optional)</span></label>
                            <input 
                                type="number" 
                                value={formData.registrationFee} 
                                onChange={(e) => setFormData({...formData, registrationFee: e.target.value})}
                                className="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none" 
                                placeholder="Enter amount if different"
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
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                            Import Member
                        </button>
                    </div>
                </form>
            ) : (
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle className="w-8 h-8 text-emerald-600" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Member Imported Successfully!</h3>
                    <p className="text-slate-600 mb-6">
                        The account has been created and prepared for onboarding.
                    </p>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left">
                        <p className="text-sm font-semibold text-slate-700 mb-2">Password Reset Link</p>
                        <p className="text-xs text-slate-500 mb-3">
                            Send this link to the user so they can set their password and complete their onboarding form.
                        </p>
                        <div className="flex items-center gap-2">
                            <input 
                                type="text" 
                                readOnly 
                                value={successData.resetLink} 
                                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-600 outline-none"
                            />
                            <button
                                onClick={copyToClipboard}
                                className="p-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg transition shrink-0"
                                title="Copy to clipboard"
                            >
                                {copied ? <CheckCircle className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={handleClose}
                        className="mt-6 w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition"
                    >
                        Done
                    </button>
                </div>
            )}
        </Modal>
    );
}
