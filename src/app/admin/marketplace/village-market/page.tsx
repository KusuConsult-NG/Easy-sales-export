/**
 * Admin — Village Market Event Manager
 * /admin/marketplace/village-market
 * 
 * Create and manage Village Market flash-sale events, add external merchants
 */

"use client";

import { useState, useEffect } from "react";
import {
    MapPin, Clock, Users, Plus, Zap, Loader2, Calendar,
    CheckCircle, XCircle, AlertCircle, ExternalLink,
} from "lucide-react";
import {
    createVillageMarketEventAction,
    getActiveVillageMarketEventsAction,
    updateVillageMarketEventStatusAction,
    addExternalMerchantAction,
} from "@/app/actions/village-market";
import type { VillageMarketEvent } from "@/lib/types/marketplace";
import { useToast } from "@/contexts/ToastContext";

const fmtDate = (val: any) => {
    if (!val) return "—";
    const d = val?.toDate ? val.toDate() : new Date(val);
    return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(d);
};

const STATUS_COLORS: Record<string, string> = {
    draft: "bg-slate-100 text-slate-600",
    published: "bg-blue-100 text-blue-700",
    active: "bg-green-100 text-green-700",
    completed: "bg-purple-100 text-purple-700",
    cancelled: "bg-red-100 text-red-700",
};

const STATES = ["Abuja FCT", "Lagos", "Kano", "Kaduna", "Rivers", "Oyo", "Ogun", "Anambra", "Enugu", "Delta", "Katsina", "Sokoto", "Borno", "Adamawa", "Jigawa", "Niger", "Benue", "Edo", "Imo", "Abia", "Cross River", "Akwa Ibom", "Plateau", "Ekiti", "Ondo", "Osun", "Kwara", "Kebbi", "Taraba", "Nasarawa", "Zamfara", "Yobe", "Gombe", "Bauchi", "Bayelsa", "Ebonyi"];

function CreateEventModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({
        title: "", description: "", location: "", state: "Abuja FCT",
        startTime: "", endTime: "",
        isRecurring: false, recurringDay: "Weekly",
        maxSellers: "50", maxProductsPerSeller: "10",
    });

    async function handleCreate() {
        if (!form.title || !form.location || !form.startTime || !form.endTime)
            return showToast("All required fields must be filled", "error");

        setLoading(true);
        const res = await createVillageMarketEventAction({
            title: form.title,
            description: form.description || undefined,
            location: form.location,
            state: form.state,
            startTime: new Date(form.startTime).toISOString(),
            endTime: new Date(form.endTime).toISOString(),
            isRecurring: form.isRecurring,
            recurringDay: form.isRecurring ? form.recurringDay : undefined,
        });
        setLoading(false);

        if (res.success) {
            showToast("Village Market event created!", "success");
            onCreated();
            onClose();
        } else {
            showToast(res.error || "Failed to create event", "error");
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl my-8" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-xl font-bold text-slate-900 mb-5">Create Village Market Event</h3>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Event Title *</label>
                        <input type="text" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                            placeholder="e.g. Kuje Weekly Market Flash Sale"
                            className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
                        <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                            placeholder="Describe the market event..."
                            rows={2}
                            className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Location / Market Name *</label>
                            <input type="text" value={form.location} onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))}
                                placeholder="e.g. Kuje Market Square"
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">State *</label>
                            <select value={form.state} onChange={(e) => setForm(f => ({ ...f, state: e.target.value }))}
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white">
                                {STATES.map(s => <option key={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Start Time *</label>
                            <input type="datetime-local" value={form.startTime} onChange={(e) => setForm(f => ({ ...f, startTime: e.target.value }))}
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">End Time *</label>
                            <input type="datetime-local" value={form.endTime} onChange={(e) => setForm(f => ({ ...f, endTime: e.target.value }))}
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Max Sellers</label>
                            <input type="number" value={form.maxSellers} onChange={(e) => setForm(f => ({ ...f, maxSellers: e.target.value }))}
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Max Products / Seller</label>
                            <input type="number" value={form.maxProductsPerSeller} onChange={(e) => setForm(f => ({ ...f, maxProductsPerSeller: e.target.value }))}
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <input type="checkbox" id="recurring" checked={form.isRecurring}
                            onChange={(e) => setForm(f => ({ ...f, isRecurring: e.target.checked }))}
                            className="w-4 h-4 accent-emerald-600" />
                        <label htmlFor="recurring" className="text-sm font-semibold text-slate-700">Recurring Event</label>
                    </div>
                    {form.isRecurring && (
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Recurrence</label>
                            <select value={form.recurringDay} onChange={(e) => setForm(f => ({ ...f, recurringDay: e.target.value }))}
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent">
                                {["Weekly", "Every Monday", "Every Tuesday", "Every Wednesday", "Every Thursday", "Every Friday", "Every Saturday", "Every Sunday", "Bi-weekly", "Monthly"].map(d => <option key={d}>{d}</option>)}
                            </select>
                        </div>
                    )}
                </div>

                <div className="flex gap-3 mt-6">
                    <button onClick={onClose} className="flex-1 py-3 border border-slate-300 rounded-xl text-slate-700 font-semibold hover:bg-slate-50 transition">Cancel</button>
                    <button
                        onClick={handleCreate}
                        disabled={loading}
                        className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Create Event
                    </button>
                </div>
            </div>
        </div>
    );
}

function AddMerchantModal({ eventId, onClose, onAdded }: { eventId: string; onClose: () => void; onAdded: () => void }) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({ name: "", products: "", phoneNumber: "", description: "" });

    async function handle() {
        if (!form.name) return showToast("Merchant name is required", "error");
        setLoading(true);
        const res = await addExternalMerchantAction(eventId, { displayName: form.name, productsDescription: form.products || undefined, phone: form.phoneNumber || undefined, businessName: form.description || undefined });
        setLoading(false);
        if (res.success) { showToast("External merchant added!", "success"); onAdded(); onClose(); }
        else showToast(res.error || "Failed", "error");
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-xl font-bold text-slate-900 mb-5">Add External Market Merchant</h3>
                <div className="space-y-4">
                    {[
                        { label: "Merchant / Stall Name *", key: "name", placeholder: "e.g. Mama Ngozi Tomatoes" },
                        { label: "Products Description", key: "products", placeholder: "e.g. Fresh tomatoes, peppers, onions" },
                        { label: "Phone Number", key: "phoneNumber", placeholder: "e.g. 08012345678" },
                        { label: "Description", key: "description", placeholder: "Any additional info..." },
                    ].map(({ label, key, placeholder }) => (
                        <div key={key}>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
                            <input type="text" value={form[key as keyof typeof form]} onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))}
                                placeholder={placeholder}
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent" />
                        </div>
                    ))}
                </div>
                <div className="flex gap-3 mt-6">
                    <button onClick={onClose} className="flex-1 py-3 border border-slate-300 rounded-xl text-slate-700 font-semibold hover:bg-slate-50 transition">Cancel</button>
                    <button onClick={handle} disabled={loading}
                        className="flex-1 py-3 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />} Add Merchant
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function AdminVillageMarketPage() {
    const { showToast } = useToast();
    const [events, setEvents] = useState<VillageMarketEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [addMerchantEventId, setAddMerchantEventId] = useState<string | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        const data = await getActiveVillageMarketEventsAction();
        setEvents(data);
        setLoading(false);
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, []);

    const handleStatus = async (eventId: string, status: "active" | "ended" | "cancelled") => {
        setProcessingId(eventId);
        const res = await updateVillageMarketEventStatusAction(eventId, status);
        setProcessingId(null);
        if (res.success) { showToast(`Event status updated to ${status}`, "success"); load(); }
        else showToast(res.error || "Failed", "error");
    };

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-1">Village Market Events</h1>
                    <p className="text-slate-600">Create and manage flash-sale events and external merchants</p>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="px-5 py-2.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition flex items-center gap-2"
                >
                    <Plus className="w-5 h-5" /> Create Event
                </button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
                </div>
            ) : events.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
                    <Calendar className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-slate-900 mb-2">No Events</h3>
                    <p className="text-slate-500 mb-6">Create your first Village Market event to get started.</p>
                    <button onClick={() => setShowCreate(true)} className="px-6 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition flex items-center gap-2 mx-auto">
                        <Plus className="w-4 h-4" /> Create First Event
                    </button>
                </div>
            ) : (
                <div className="space-y-4">
                    {events.map((event) => (
                        <div key={event.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                            <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                                <div>
                                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                                        <h3 className="text-lg font-bold text-slate-900">{event.title}</h3>
                                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${STATUS_COLORS[event.status] || "bg-slate-100"}`}>
                                            {event.status}
                                        </span>
                                        {event.isRecurring && (
                                            <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">
                                                {event.recurringDay}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                                        <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{event.location}, {event.state}</span>
                                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{fmtDate(event.startTime)} — {fmtDate(event.endTime)}</span>
                                        <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{event.participantSellerIds?.length || 0} sellers</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-slate-100 flex-wrap gap-3">
                                {/* Status Controls */}
                                <div className="flex gap-2 flex-wrap">
                                    {event.status === "upcoming" && (
                                        <button onClick={() => handleStatus(event.id, "active")} disabled={processingId === event.id}
                                            className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-1">
                                            {processingId === event.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} Activate
                                        </button>
                                    )}
                                    {event.status === "active" && (
                                        <>
                                            <button onClick={() => handleStatus(event.id, "ended")} disabled={processingId === event.id}
                                                className="px-3 py-1.5 bg-purple-600 text-white text-xs font-bold rounded-lg hover:bg-purple-700 transition disabled:opacity-50 flex items-center gap-1">
                                                <CheckCircle className="w-3 h-3" /> End Event
                                            </button>
                                            <button onClick={() => handleStatus(event.id, "cancelled")} disabled={processingId === event.id}
                                                className="px-3 py-1.5 border border-red-300 text-red-700 text-xs font-bold rounded-lg hover:bg-red-50 transition disabled:opacity-50 flex items-center gap-1">
                                                <XCircle className="w-3 h-3" /> Cancel
                                            </button>
                                        </>
                                    )}
                                </div>

                                <button
                                    onClick={() => setAddMerchantEventId(event.id)}
                                    className="px-3 py-1.5 border border-amber-300 text-amber-700 text-xs font-bold rounded-lg hover:bg-amber-50 transition flex items-center gap-1"
                                >
                                    <ExternalLink className="w-3 h-3" /> Add Market Merchant
                                </button>
                            </div>

                            {/* External Merchants */}
                            {event.externalMerchants && event.externalMerchants.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-slate-100">
                                    <p className="text-xs font-semibold text-slate-500 mb-2">External Merchants ({event.externalMerchants.length})</p>
                                    <div className="flex flex-wrap gap-2">
                                        {event.externalMerchants.map((m) => (
                                            <div key={m.id} className="px-3 py-1 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 font-medium">
                                                {m.displayName}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {showCreate && <CreateEventModal onClose={() => setShowCreate(false)} onCreated={load} />}
            {addMerchantEventId && (
                <AddMerchantModal
                    eventId={addMerchantEventId}
                    onClose={() => setAddMerchantEventId(null)}
                    onAdded={load}
                />
            )}
        </div>
    );
}
