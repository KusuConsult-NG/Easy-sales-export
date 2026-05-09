
"use client";

import React from "react";
import { X, FileText, User, MapPin, CreditCard, Calendar, Activity, CheckCircle2, AlertCircle, Info } from "lucide-react";

interface DynamicDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    data: Record<string, any>;
    excludeKeys?: string[];
}

const DynamicDetailModal: React.FC<DynamicDetailModalProps> = ({
    isOpen,
    onClose,
    title,
    data,
    excludeKeys = []
}) => {
    if (!isOpen) return null;

    const defaultExclude = [
        "id", "userId", "updatedAt", "_version", "applicationDate", 
        "reviewedAt", "reviewedBy", "approvedAt", "approvedBy", 
        "rejectionReason", "status", "userEmail", "fullName"
    ];
    
    const allExcluded = [...defaultExclude, ...excludeKeys];

    // Helper to format keys into labels
    const formatLabel = (key: string) => {
        return key
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (str) => str.toUpperCase())
            .replace(/_/g, " ");
    };

    // Helper to format values
    const formatValue = (value: any): React.ReactNode => {
        if (value === null || value === undefined) return <span className="text-slate-400 italic">Not provided</span>;
        if (typeof value === "boolean") {
            return value ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
                    <CheckCircle2 className="w-4 h-4" /> Yes
                </span>
            ) : (
                <span className="inline-flex items-center gap-1 text-slate-500">
                    <X className="w-4 h-4" /> No
                </span>
            );
        }
        if (Array.isArray(value)) {
            if (value.length === 0) return <span className="text-slate-400 italic">None</span>;
            return (
                <div className="flex flex-wrap gap-1.5 mt-1">
                    {value.map((v, i) => (
                        <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-xs font-semibold border border-slate-200">
                            {String(v).replace(/_/g, ' ')}
                        </span>
                    ))}
                </div>
            );
        }
        if (typeof value === "object" && value._seconds) {
            // Firestore Timestamp
            return new Date(value._seconds * 1000).toLocaleString("en-NG");
        }
        if (typeof value === "object") {
            return <pre className="text-xs bg-slate-50 p-2 rounded overflow-auto max-h-32">{JSON.stringify(value, null, 2)}</pre>;
        }
        return String(value);
    };

    // Grouping logic (Basic heuristic)
    const groups: Record<string, { label: string; icon: any; fields: [string, any][] }> = {
        personal: { label: "Personal Information", icon: User, fields: [] },
        location: { label: "Location Details", icon: MapPin, fields: [] },
        professional: { label: "Professional & Financial", icon: CreditCard, fields: [] },
        program: { label: "Program Specific", icon: Activity, fields: [] },
        other: { label: "Supplemental Data", icon: Info, fields: [] },
    };

    Object.entries(data).forEach(([key, value]) => {
        if (allExcluded.includes(key)) return;

        const k = key.toLowerCase();
        if (k.includes("name") || k.includes("surname") || k.includes("phone") || k.includes("email") || k.includes("dob") || k.includes("birth") || k.includes("marital")) {
            groups.personal.fields.push([key, value]);
        } else if (k.includes("address") || k.includes("state") || k.includes("lga") || k.includes("ward") || k.includes("pu") || k.includes("unit")) {
            groups.location.fields.push([key, value]);
        } else if (k.includes("bank") || k.includes("account") || k.includes("bvn") || k.includes("nin") || k.includes("income") || k.includes("education") || k.includes("occupation")) {
            groups.professional.fields.push([key, value]);
        } else if (k.includes("agriculture") || k.includes("farm") || k.includes("commodity") || k.includes("crop") || k.includes("training") || k.includes("cooperative")) {
            groups.program.fields.push([key, value]);
        } else {
            groups.other.fields.push([key, value]);
        }
    });

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col border border-white/20 animate-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                            <FileText className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900 leading-tight">{title}</h2>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-0.5">Comprehensive Form Submission</p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="w-10 h-10 rounded-xl hover:bg-slate-200 flex items-center justify-center transition-all text-slate-400 hover:text-slate-900"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
                    {Object.values(groups).map((group, idx) => (
                        group.fields.length > 0 && (
                            <section key={idx} className="relative">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="p-2 rounded-lg bg-slate-100">
                                        <group.icon className="w-5 h-5 text-slate-600" />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900">{group.label}</h3>
                                    <div className="h-px bg-slate-100 flex-1 ml-4" />
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
                                    {group.fields.map(([key, value]) => (
                                        <div key={key} className="space-y-1.5 group">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-primary transition-colors">
                                                {formatLabel(key)}
                                            </label>
                                            <div className="text-sm font-semibold text-slate-800 break-words leading-relaxed">
                                                {formatValue(value)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )
                    ))}

                    {/* Metadata Footer */}
                    <div className="mt-12 pt-8 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="bg-slate-50 p-4 rounded-2xl">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">ID</p>
                            <p className="text-xs font-mono font-bold text-slate-600 truncate">{data.id}</p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-2xl">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Status</p>
                            <p className={`text-xs font-bold capitalize ${
                                data.status === 'approved' ? 'text-emerald-600' : 
                                data.status === 'rejected' ? 'text-red-600' : 'text-amber-600'
                            }`}>{data.status || 'Pending'}</p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-2xl">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Submitted</p>
                            <p className="text-xs font-bold text-slate-600">
                                {data.createdAt ? formatValue(data.createdAt) : 'Unknown'}
                            </p>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-2xl">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Version</p>
                            <p className="text-xs font-bold text-slate-600">v{data._version || 1}.0</p>
                        </div>
                    </div>
                </div>

                {/* Footer Action */}
                <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
                    <button 
                        onClick={onClose}
                        className="px-8 py-3 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-lg hover:shadow-slate-200"
                    >
                        Finished Review
                    </button>
                </div>
            </div>

            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #e2e8f0;
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #cbd5e1;
                }
            `}</style>
        </div>
    );
};

export default DynamicDetailModal;
