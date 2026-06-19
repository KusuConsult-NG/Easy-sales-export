/**
 * Village Market — Seller Hub
 * /marketplace/village-market/seller
 *
 * Approved sellers can view upcoming/active events, join them,
 * and manage their own flash-sale product listings from here.
 */

"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    Zap, Calendar, MapPin, Clock, Users, Plus, Loader2,
    Package, CheckCircle, AlertCircle, ArrowRight, ShoppingBag,
    Camera, X,
} from "lucide-react";
import {
    getActiveVillageMarketEventsAction,
    joinVillageMarketEventAction,
    addFlashSaleProductAction,
} from "@/app/actions/village-market";
import type { VillageMarketEvent } from "@/lib/types/marketplace";
import { useToast } from "@/contexts/ToastContext";

const fmtDate = (val: any) => {
    if (!val) return "—";
    const d = val?.toDate ? val.toDate() : new Date(val);
    return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(d);
};

function AddProductModal({
    eventId,
    onClose,
    onAdded,
}: {
    eventId: string;
    onClose: () => void;
    onAdded: () => void;
}) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [customUnit, setCustomUnit] = useState("");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [form, setForm] = useState({
        title: "",
        description: "",
        price: "",
        flashPrice: "",
        unit: "Kwanu",
        availableQuantity: "",
    });

    async function handle() {
        if (!form.title || !form.price) return showToast("Title and price are required", "error");
        setLoading(true);
        
        let uploadedUrl: string | undefined = undefined;
        if (selectedFile) {
            try {
                const formData = new FormData();
                formData.append("file", selectedFile);
                formData.append("folder", "flash-sale-products");
                formData.append("documentType", "product-image");
                
                const uploadRes = await fetch("/api/upload", {
                    method: "POST",
                    body: formData
                });
                
                if (!uploadRes.ok) {
                    throw new Error("Failed to upload image");
                }
                
                const uploadData = await uploadRes.json();
                if (uploadData.success && uploadData.url) {
                    uploadedUrl = uploadData.url;
                } else {
                    throw new Error(uploadData.error || "Failed to upload image");
                }
            } catch (err: any) {
                setLoading(false);
                return showToast(err.message || "Failed to upload image", "error");
            }
        }

        const finalUnit = form.unit === "other units" ? customUnit : form.unit;
        const res = await addFlashSaleProductAction({
            eventId,
            title: form.title,
            description: form.description || undefined,
            price: Number(form.price),
            flashPrice: form.flashPrice ? Number(form.flashPrice) : undefined,
            unit: finalUnit || undefined,
            availableQuantity: form.availableQuantity ? Number(form.availableQuantity) : undefined,
            imageUrl: uploadedUrl,
        });
        setLoading(false);
        if (res.success) {
            showToast("Product listed for flash sale!", "success");
            onAdded();
            onClose();
        } else {
            showToast(res.error || "Failed to add product", "error");
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleClearImage = () => {
        setSelectedFile(null);
        setImagePreview(null);
    };

    const units = [
        "Kwanu",
        "mudu/darica",
        "basket(small)",
        "basket(medium)",
        "basket(big)",
        "small painter bucket",
        "big painter bucket",
        "small carton",
        "big carton",
        "other units"
    ];

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
                        <Zap className="w-5 h-5 text-orange-600" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">Add Flash Sale Product</h3>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Product Title *</label>
                        <input type="text" value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                            placeholder="e.g., Fresh Tomatoes"
                            className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
                        <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                            placeholder="Describe your product..."
                            rows={2}
                            className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none outline-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Regular Price (₦) *</label>
                            <input type="number" value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                                placeholder="5000" min="0"
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Flash Price (₦)</label>
                            <input type="number" value={form.flashPrice} onChange={(e) => setForm(f => ({ ...f, flashPrice: e.target.value }))}
                                placeholder="3500" min="0"
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Unit *</label>
                            <select value={form.unit} onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))}
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-orange-500 bg-white outline-none">
                                {units.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                            {form.unit === "other units" && (
                                <input type="text" value={customUnit} onChange={(e) => setCustomUnit(e.target.value)}
                                    placeholder="Enter custom unit"
                                    className="mt-2 w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" />
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Available Qty</label>
                            <input type="number" value={form.availableQuantity} onChange={(e) => setForm(f => ({ ...f, availableQuantity: e.target.value }))}
                                placeholder="50" min="1"
                                className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-slate-900 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none" />
                        </div>
                    </div>
                    
                    {/* Image Upload Widget */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">Product Image</label>
                        {imagePreview ? (
                            <div className="relative h-40 w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                                <button
                                    type="button"
                                    onClick={handleClearImage}
                                    className="absolute top-2 right-2 p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full transition shadow hover:scale-105"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ) : (
                            <label className="border-2 border-dashed border-slate-300 hover:border-orange-500 rounded-xl p-5 flex flex-col items-center justify-center cursor-pointer transition bg-slate-50 hover:bg-orange-50/10 group">
                                <Camera className="w-7 h-7 text-slate-400 mb-1.5 group-hover:text-orange-500 transition" />
                                <span className="text-xs font-semibold text-slate-600 group-hover:text-orange-600 transition">Upload product image</span>
                                <span className="text-[10px] text-slate-400 mt-0.5">PNG, JPG up to 5MB</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                    className="hidden"
                                />
                            </label>
                        )}
                    </div>
                </div>

                <div className="flex gap-3 mt-6">
                    <button onClick={onClose} className="flex-1 py-3 border border-slate-300 rounded-xl text-slate-700 font-semibold hover:bg-slate-50 transition">Cancel</button>
                    <button
                        onClick={handle}
                        disabled={loading}
                        className="flex-1 py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Add Product
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function VillageMarketSellerHubPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const { showToast } = useToast();

    const [events, setEvents] = useState<VillageMarketEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [joiningId, setJoiningId] = useState<string | null>(null);
    const [addProductEventId, setAddProductEventId] = useState<string | null>(null);

    useEffect(() => {
        if (status === "unauthenticated") router.push("/auth/signin");
    }, [status, router]);

    async function load() {
        setLoading(true);
        const data = await getActiveVillageMarketEventsAction();
        setEvents(data);
        setLoading(false);
    };

     
    useEffect(() => { load(); }, []);

    async function handleJoin(eventId: string) {
        setJoiningId(eventId);
        const res = await joinVillageMarketEventAction(eventId);
        setJoiningId(null);
        if (res.success) {
            showToast("You've joined the event! You can now add products.", "success");
            const currentUserId = (session?.user as any)?.id || session?.user?.id;
            if (currentUserId) {
                setEvents(prev => prev.map(evt => {
                    if (evt.id === eventId) {
                        const ids = evt.participantSellerIds || [];
                        return {
                            ...evt,
                            participantSellerIds: ids.includes(currentUserId) ? ids : [...ids, currentUserId]
                        };
                    }
                    return evt;
                }));
            }
            load();
        } else {
            showToast(res.error || "Failed to join event", "error");
        }
    };

    const userId = (session?.user as any)?.id ?? "";

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="bg-linear-to-br from-orange-500 to-amber-600 rounded-2xl p-8 mb-8 text-white">
                    <div className="flex items-center gap-4 mb-3">
                        <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center">
                            <Zap className="w-7 h-7" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold">Village Market Hub</h1>
                            <p className="text-white/80">Join flash-sale events and list your products</p>
                        </div>
                    </div>
                </div>

                {/* How it works */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-8">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">How it works</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {[
                            { step: "1", title: "Join an Event", desc: "Select an upcoming or active Village Market event and join it.", icon: Calendar },
                            { step: "2", title: "List Products", desc: "Add your products with optional flash-sale discounted prices.", icon: Package },
                            { step: "3", title: "Sell & Earn", desc: "Buyers browse and purchase directly from your flash listings.", icon: ShoppingBag },
                        ].map(({ step, title, desc, icon: Icon }) => (
                            <div key={step} className="flex gap-3">
                                <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0 font-bold text-orange-600 text-sm">
                                    {step}
                                </div>
                                <div>
                                    <p className="font-semibold text-slate-900">{title}</p>
                                    <p className="text-sm text-slate-500 mt-0.5">{desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Events list */}
                <h2 className="text-xl font-bold text-slate-900 mb-4">Open Events</h2>

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-10 h-10 animate-spin text-orange-500" />
                    </div>
                ) : events.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-16 text-center">
                        <Calendar className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-900 mb-2">No Events Available</h3>
                        <p className="text-slate-500">Check back soon — the admin posts Village Market events regularly.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {events.map((event) => {
                            const isJoined = event.participantSellerIds?.includes(userId);
                            const isActive = event.status === "active";
                            return (
                                <div key={event.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
                                    <div className="flex items-start justify-between gap-4 flex-wrap">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <h3 className="font-bold text-slate-900">{event.title}</h3>
                                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${isActive ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                                                    }`}>
                                                    {event.status}
                                                </span>
                                                {isJoined && (
                                                    <span className="px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-bold flex items-center gap-1">
                                                        <CheckCircle className="w-3 h-3" /> Joined
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap gap-3 text-sm text-slate-500">
                                                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{event.location}, {event.state}</span>
                                                <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{fmtDate(event.startTime)} — {fmtDate(event.endTime)}</span>
                                                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{event.participantSellerIds?.length || 0} sellers</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 flex-wrap">
                                            {!isJoined ? (
                                                <button
                                                    onClick={() => handleJoin(event.id)}
                                                    disabled={joiningId === event.id}
                                                    className="px-4 py-2 bg-orange-500 text-white text-sm font-bold rounded-xl hover:bg-orange-600 transition disabled:opacity-50 flex items-center gap-2"
                                                >
                                                    {joiningId === event.id
                                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                                        : <Zap className="w-4 h-4" />
                                                    }
                                                    Join Event
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => setAddProductEventId(event.id)}
                                                    className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition flex items-center gap-2"
                                                >
                                                    <Plus className="w-4 h-4" /> Add Product
                                                </button>
                                            )}
                                            <Link
                                                href={`/marketplace/village-market/${event.id}`}
                                                className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-50 transition flex items-center gap-1"
                                            >
                                                View <ArrowRight className="w-3.5 h-3.5" />
                                            </Link>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {addProductEventId && (
                <AddProductModal
                    eventId={addProductEventId}
                    onClose={() => setAddProductEventId(null)}
                    onAdded={load}
                />
            )}
        </div>
    );
}
