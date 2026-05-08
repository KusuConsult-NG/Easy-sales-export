"use client";

import { useState } from "react";
import { Mail, Loader2, CheckCircle, GraduationCap, ShieldCheck, User } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { onboardLegacyMemberAction } from "@/app/actions/admin";

interface ImportLegacyModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function ImportLegacyModal({ isOpen, onClose, onSuccess }: ImportLegacyModalProps) {
    const [formData, setFormData] = useState({
        email: "",
        fullName: "",
        phone: "",
        academyPlan: "foundation" as "foundation" | "standard" | "elite",
        services: {
            cooperative: true, // Default to coop as this is often where it's called from
            academy: true,
            marketplace: false,
            export: false,
            wave: false,
            farmNation: false,
        }
    });
    
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSuccess, setIsSuccess] = useState(false);
    const [tempPassword, setTempPassword] = useState("");

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setIsLoading(true);

        // Prepare roles based on services
        const roles: string[] = ["general_user"];
        if (formData.services.cooperative) roles.push("cooperative_member");
        if (formData.services.academy) roles.push("academy_participant");
        if (formData.services.marketplace) roles.push("marketplace_buyer");
        if (formData.services.export) roles.push("export_participant");
        if (formData.services.wave) roles.push("wave_participant");
        if (formData.services.farmNation) roles.push("farmer");

        const payload = {
            ...formData,
            roles,
            // Minimal required location data for schema (can be empty but must exist)
            state: "Lagos", 
            lga: "Lagos Island",
            address: "Legacy User Address",
        };

        const result = await onboardLegacyMemberAction(payload);
        
        setIsLoading(false);

        if (result.success) {
            setIsSuccess(true);
            // Extract the generated PIN from the message if possible, or just show the success message
            // onboardLegacyMemberAction returns { message: "Legacy member ... Default PIN sent to ..." }
            onSuccess(); // Refresh the table
        } else {
            setError(result.error || "Failed to onboard member.");
        }
    };

    function handleClose() {
        setFormData({
            email: "",
            fullName: "",
            phone: "",
            academyPlan: "foundation",
            services: {
                cooperative: true,
                academy: true,
                marketplace: false,
                export: false,
                wave: false,
                farmNation: false,
            }
        });
        setIsSuccess(false);
        setError(null);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Onboard Legacy Member" maxWidth="lg">
            {!isSuccess ? (
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                        <p className="text-sm text-indigo-800">
                            Create a direct account for a legacy member. They will be immediately provisioned with full access to selected services. A default PIN will be generated and emailed.
                        </p>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm break-all">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-4">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                <User className="w-3.5 h-3.5" /> Identity
                            </h3>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name <span className="text-red-500">*</span></label>
                                <input 
                                    type="text" 
                                    required
                                    value={formData.fullName} 
                                    onChange={(e) => setFormData({...formData, fullName: e.target.value})}
                                    className="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                                    placeholder="e.g. John Doe"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address <span className="text-red-500">*</span></label>
                                <input 
                                    type="email" 
                                    required
                                    value={formData.email} 
                                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                                    className="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                                    placeholder="member@example.com"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number <span className="text-red-500">*</span></label>
                                <input 
                                    type="tel" 
                                    required
                                    value={formData.phone} 
                                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                                    className="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" 
                                    placeholder="e.g. +2348012345678"
                                />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                <GraduationCap className="w-3.5 h-3.5" /> Academy Access
                            </h3>
                            
                            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-4">
                                <div className="flex items-center gap-3">
                                    <input 
                                        type="checkbox"
                                        id="service-academy"
                                        checked={formData.services.academy}
                                        onChange={(e) => setFormData({
                                            ...formData, 
                                            services: {...formData.services, academy: e.target.checked}
                                        })}
                                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                    />
                                    <label htmlFor="service-academy" className="text-sm font-semibold text-slate-700">Enable Academy Enrollment</label>
                                </div>

                                {formData.services.academy && (
                                    <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                                        <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Select Academy Tier</label>
                                        <select 
                                            value={formData.academyPlan}
                                            onChange={(e) => setFormData({...formData, academyPlan: e.target.value as any})}
                                            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                        >
                                            <option value="foundation">Foundation (₦25,000 Value)</option>
                                            <option value="standard">Standard (₦50,000 Value)</option>
                                            <option value="elite">Elite (₦100,000 Value)</option>
                                        </select>
                                    </div>
                                )}
                            </div>

                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2 pt-2">
                                <ShieldCheck className="w-3.5 h-3.5" /> Other Services
                            </h3>
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    { id: 'cooperative', label: 'Cooperative' },
                                    { id: 'marketplace', label: 'Marketplace' },
                                    { id: 'export', label: 'Export Hub' },
                                    { id: 'wave', label: 'WAVE' },
                                ].map((service) => (
                                    <div key={service.id} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-100">
                                        <input 
                                            type="checkbox"
                                            id={`service-${service.id}`}
                                            checked={(formData.services as any)[service.id]}
                                            onChange={(e) => setFormData({
                                                ...formData, 
                                                services: {...formData.services, [service.id]: e.target.checked}
                                            })}
                                            className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500"
                                        />
                                        <label htmlFor={`service-${service.id}`} className="text-xs font-medium text-slate-600">{service.label}</label>
                                    </div>
                                ))}
                            </div>
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
                            className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-blue-200"
                        >
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            Complete Onboarding
                        </button>
                    </div>
                </form>
            ) : (
                <div className="text-center py-8">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle className="w-10 h-10 text-green-600" />
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900 mb-2">Successfully Onboarded!</h3>
                    <p className="text-slate-600 mb-8 max-w-sm mx-auto">
                        <strong>{formData.fullName}</strong> has been provisioned as a legacy member. 
                        Their login credentials and temporary PIN have been sent to <strong>{formData.email}</strong>.
                    </p>

                    <button
                        onClick={handleClose}
                        className="w-full max-w-xs px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-xl shadow-blue-100"
                    >
                        Return to Dashboard
                    </button>
                </div>
            )}
        </Modal>
    );
}
