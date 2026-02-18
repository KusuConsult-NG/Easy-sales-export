"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Plus, Trash2, Loader2, FileText, Calendar, List } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import { getExportRequestByIdAction, updateExportWindowAction } from "@/app/actions/export";
import type { ExportWindow } from "@/lib/types/firestore";

export default function EditExportWindowPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { showToast } = useToast();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Form State
    const [windowData, setWindowData] = useState<Partial<ExportWindow>>({});

    // Deep Data State
    const [timeline, setTimeline] = useState<any[]>([]);
    const [documents, setDocuments] = useState<any[]>([]);
    const [specs, setSpecs] = useState<string[]>([]);
    const [benefits, setBenefits] = useState<string[]>([]);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        const result = await getExportRequestByIdAction(id);
        if (result.success && result.export) {
            const data = result.export;
            setWindowData(data);
            setTimeline(data.timeline || []);
            setDocuments(data.documents || []);
            setSpecs(data.specifications || []);
            setBenefits(data.benefits || []);
        } else {
            showToast("Failed to load export window", "error");
            router.push("/admin/export");
        }
        setLoading(false);
    }

    async function handleSave() {
        setSaving(true);
        const updateData = {
            ...windowData,
            timeline,
            documents,
            specifications: specs,
            benefits,
        };

        const result = await updateExportWindowAction(id, updateData);

        if (result.success) {
            showToast("Export Window updated successfully", "success");
            router.refresh();
        } else {
            showToast(result.error || "Failed to update", "error");
        }
        setSaving(false);
    }

    // Helper to generic field update
    const updateField = (field: string, value: any) => {
        setWindowData(prev => ({ ...prev, [field]: value }));
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/admin/export"
                            className="p-2 hover:bg-slate-200 rounded-lg transition"
                        >
                            <ArrowLeft className="w-5 h-5 text-slate-600" />
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">
                                Edit Export Window
                            </h1>
                            <p className="text-slate-500 text-sm">
                                ID: {id}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium shadow-lg shadow-blue-600/20"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Changes
                    </button>
                </div>

                <div className="space-y-6">
                    {/* Basic Info */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                            <List className="w-5 h-5 text-blue-500" />
                            Core Details
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Title</label>
                                <input
                                    type="text"
                                    value={windowData.title || ""}
                                    onChange={e => updateField("title", e.target.value)}
                                    placeholder="e.g. Q1 2026 Yam Export"
                                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Duration</label>
                                <input
                                    type="text"
                                    value={windowData.duration || ""}
                                    onChange={e => updateField("duration", e.target.value)}
                                    placeholder="e.g. 6 Months"
                                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">ROI</label>
                                <input
                                    type="text"
                                    value={windowData.roi || ""}
                                    onChange={e => updateField("roi", e.target.value)}
                                    placeholder="e.g. 15-25%"
                                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Min Investment (₦)</label>
                                <input
                                    type="number"
                                    value={windowData.amount || 0}
                                    onChange={e => updateField("amount", Number(e.target.value))}
                                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                                />
                            </div>
                            <div className="col-span-2">
                                <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
                                <textarea
                                    value={windowData.description || ""}
                                    onChange={e => updateField("description", e.target.value)}
                                    rows={4}
                                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Timeline */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                <Calendar className="w-5 h-5 text-purple-500" />
                                Project Timeline
                            </h3>
                            <button
                                onClick={() => setTimeline([...timeline, { phase: "", date: "", status: "pending" }])}
                                className="text-sm text-blue-600 font-medium hover:underline"
                            >
                                + Add Phase
                            </button>
                        </div>
                        <div className="space-y-3">
                            {timeline.map((phase, idx) => (
                                <div key={idx} className="flex gap-2 items-start">
                                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                                        <input
                                            placeholder="Phase Name (e.g. Procurement)"
                                            value={phase.phase}
                                            onChange={e => {
                                                const newTimeline = [...timeline];
                                                newTimeline[idx].phase = e.target.value;
                                                setTimeline(newTimeline);
                                            }}
                                            className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                                        />
                                        <input
                                            placeholder="Date/Duration (e.g. 2 Weeks)"
                                            value={phase.date}
                                            onChange={e => {
                                                const newTimeline = [...timeline];
                                                newTimeline[idx].date = e.target.value;
                                                setTimeline(newTimeline);
                                            }}
                                            className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                                        />
                                        <select
                                            value={phase.status}
                                            onChange={e => {
                                                const newTimeline = [...timeline];
                                                newTimeline[idx].status = e.target.value;
                                                setTimeline(newTimeline);
                                            }}
                                            className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                                        >
                                            <option value="pending">Pending</option>
                                            <option value="active">Active</option>
                                            <option value="completed">Completed</option>
                                        </select>
                                        <textarea
                                            placeholder="Description (e.g. Sourcing raw materials from verified farms)"
                                            value={phase.description || ""}
                                            onChange={e => {
                                                const newTimeline = [...timeline];
                                                newTimeline[idx].description = e.target.value;
                                                setTimeline(newTimeline);
                                            }}
                                            className="md:col-span-3 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm h-16 resize-none"
                                        />
                                    </div>
                                    <button
                                        onClick={() => setTimeline(timeline.filter((_, i) => i !== idx))}
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Specifications */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                <List className="w-5 h-5 text-emerald-500" />
                                Specifications
                            </h3>
                            <button
                                onClick={() => setSpecs([...specs, ""])}
                                className="text-sm text-blue-600 font-medium hover:underline"
                            >
                                + Add Spec
                            </button>
                        </div>
                        <div className="space-y-3">
                            {specs.map((spec, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                    <input
                                        placeholder="Spec (e.g. Moisture Content: < 12%)"
                                        value={spec}
                                        onChange={e => {
                                            const newSpecs = [...specs];
                                            newSpecs[idx] = e.target.value;
                                            setSpecs(newSpecs);
                                        }}
                                        className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                                    />
                                    <button
                                        onClick={() => setSpecs(specs.filter((_, i) => i !== idx))}
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Benefits */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                <List className="w-5 h-5 text-amber-500" />
                                Benefits & ROI
                            </h3>
                            <button
                                onClick={() => setBenefits([...benefits, ""])}
                                className="text-sm text-blue-600 font-medium hover:underline"
                            >
                                + Add Benefit
                            </button>
                        </div>
                        <div className="space-y-3">
                            {benefits.map((benefit, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                    <input
                                        placeholder="Benefit (e.g. Fully Insured)"
                                        value={benefit}
                                        onChange={e => {
                                            const newBenefits = [...benefits];
                                            newBenefits[idx] = e.target.value;
                                            setBenefits(newBenefits);
                                        }}
                                        className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                                    />
                                    <button
                                        onClick={() => setBenefits(benefits.filter((_, i) => i !== idx))}
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Requirements / Documents */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                <FileText className="w-5 h-5 text-amber-500" />
                                Required Documents
                            </h3>
                            <button
                                onClick={() => setDocuments([...documents, { name: "", required: true }])}
                                className="text-sm text-blue-600 font-medium hover:underline"
                            >
                                + Add Document
                            </button>
                        </div>
                        <div className="space-y-3">
                            {documents.map((doc, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                    <div className="flex-1">
                                        <input
                                            placeholder="Document Name (e.g. Valid ID Card)"
                                            value={doc.name}
                                            onChange={e => {
                                                const newDocs = [...documents];
                                                newDocs[idx].name = e.target.value;
                                                setDocuments(newDocs);
                                            }}
                                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                                        />
                                    </div>
                                    <label className="flex items-center gap-2 text-sm text-slate-600">
                                        <input
                                            type="checkbox"
                                            checked={doc.required}
                                            onChange={e => {
                                                const newDocs = [...documents];
                                                newDocs[idx].required = e.target.checked;
                                                setDocuments(newDocs);
                                            }}
                                        />
                                        Required
                                    </label>
                                    <button
                                        onClick={() => setDocuments(documents.filter((_, i) => i !== idx))}
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
