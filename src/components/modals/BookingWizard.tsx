/**
 * Export Slot Booking Wizard
 * A 5-stage multi-step modal for booking an export slot.
 *
 * Stage 1 — Commodity: Select commodity & enter weight (kg)
 * Stage 2 — Specs: Moisture %, foreign matter %, phytosanitary confirmation
 * Stage 3 — Logistics: Shipping terms (FOB/CIF), Port of Origin, Cargo Vessel
 * Stage 4 — Documents: Upload Bill of Lading & Certificate of Origin
 * Stage 5 — Review & Confirm: Summary + wallet payment
 */

"use client";

import { useState, useRef } from "react";
import {
    X, Package, ChevronRight, ChevronLeft, CheckCircle, Loader2,
    FileText, Ship, FlaskConical, MapPin, Upload, AlertCircle
} from "lucide-react";
import type { ExportWindow } from "@/app/actions/export-aggregation";
import { useToast } from "@/contexts/ToastContext";
import { createBookingAction } from "@/app/actions/export-booking";

interface BookingWizardProps {
    isOpen: boolean;
    onClose: () => void;
    exportWindow: ExportWindow | null;
}

const PORTS = [
    "Lagos Apapa Port",
    "Lagos Tin Can Island Port",
    "Onne Port (Rivers State)",
    "Calabar Port",
    "Warri Port",
    "Koko Port (Delta State)",
];

const VESSELS = [
    "MV African Pearl",
    "MV Lagos Express",
    "MV Naija Trader",
    "MV Atlantic Bridge",
    "MV West African Star",
    "Other / TBD",
];

const STEPS = [
    { id: 1, label: "Commodity",  icon: Package },
    { id: 2, label: "Specs",      icon: FlaskConical },
    { id: 3, label: "Logistics",  icon: Ship },
    { id: 4, label: "Documents",  icon: FileText },
    { id: 5, label: "Confirm",    icon: CheckCircle },
];

export default function BookingWizard({ isOpen, onClose, exportWindow }: BookingWizardProps) {
    const { showToast } = useToast();
    const [step, setStep] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    // Stage 1
    const [volume, setVolume] = useState<number>(100);

    // Stage 2
    const [moisture, setMoisture] = useState<string>("");
    const [foreignMatter, setForeignMatter] = useState<string>("");
    const [hasPhyto, setHasPhyto] = useState(false);

    // Stage 3
    const [shippingTerms, setShippingTerms] = useState<"FOB" | "CIF">("FOB");
    const [port, setPort] = useState(PORTS[0]);
    const [vessel, setVessel] = useState(VESSELS[0]);

    // Stage 4
    const [bolFile, setBolFile] = useState<File | null>(null);
    const [coFile, setCoFile] = useState<File | null>(null);
    const bolRef = useRef<HTMLInputElement>(null);
    const coRef  = useRef<HTMLInputElement>(null);

    if (!isOpen || !exportWindow) return null;

    const availableVolume = exportWindow.targetVolume - exportWindow.currentVolume;
    const totalPrice = volume * exportWindow.slotPrice;

    function resetAndClose() {
        setStep(1); setVolume(100); setMoisture(""); setForeignMatter("");
        setHasPhyto(false); setShippingTerms("FOB"); setPort(PORTS[0]);
        setVessel(VESSELS[0]); setBolFile(null); setCoFile(null);
        setSuccess(false); setSubmitting(false);
        onClose();
    }

    function validateStep(): string | null {
        if (step === 1) {
            if (!volume || volume <= 0) return "Please enter a valid quantity.";
            if (volume > availableVolume) return `Maximum available is ${availableVolume.toLocaleString()}kg.`;
        }
        if (step === 2) {
            if (!moisture || isNaN(parseFloat(moisture))) return "Please enter moisture content (%).";
            if (parseFloat(moisture) < 0 || parseFloat(moisture) > 100) return "Moisture must be between 0–100%.";
            if (!foreignMatter || isNaN(parseFloat(foreignMatter))) return "Please enter foreign matter (%).";
            if (!hasPhyto) return "You must confirm you hold a valid Phytosanitary Certificate.";
        }
        if (step === 3) {
            if (!port) return "Please select a port of origin.";
            if (!vessel) return "Please select a cargo vessel.";
        }
        if (step === 4) {
            if (!bolFile) return "Please upload your Bill of Lading.";
            if (!coFile) return "Please upload your Certificate of Origin.";
        }
        return null;
    }

    function next() {
        const err = validateStep();
        if (err) { showToast(err, "error"); return; }
        setStep(s => s + 1);
    }
    function back() { setStep(s => s - 1); }

    async function handleConfirm() {
        if (!exportWindow) return;
        setSubmitting(true);
        try {
            const result = await createBookingAction({
                exportWindowId: exportWindow.id || "",
                quantity: volume,
                totalPrice,
            });
            if (result.success) {
                setSuccess(true);
                setTimeout(resetAndClose, 2500);
            } else {
                showToast(result.error || "Booking failed.", "error");
                setSubmitting(false);
            }
        } catch {
            showToast("An unexpected error occurred.", "error");
            setSubmitting(false);
        }
    }

    /* ─── Render ─── */
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div
                className="bg-white rounded-2xl w-full max-w-lg shadow-2xl animate-[slideInUp_0.3s_ease-out] overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* ── Success Screen ── */}
                {success ? (
                    <div className="p-12 text-center">
                        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-12 h-12 text-green-600" />
                        </div>
                        <h3 className="text-2xl font-bold text-slate-900 mb-2">Slot Booked!</h3>
                        <p className="text-slate-500 text-sm">Your export slot is pending confirmation. You will receive an email with payment details.</p>
                    </div>
                ) : (
                    <>
                        {/* ── Header ── */}
                        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white flex items-center justify-between">
                            <div>
                                <p className="text-blue-100 text-xs font-semibold uppercase tracking-widest mb-0.5">Export Booking</p>
                                <h2 className="text-xl font-bold">{exportWindow.title}</h2>
                            </div>
                            <button onClick={resetAndClose} className="p-2 hover:bg-white/10 rounded-lg transition">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* ── Step Indicator ── */}
                        <div className="flex items-center px-6 py-3 border-b border-slate-100 bg-slate-50 gap-1">
                            {STEPS.map((s, idx) => {
                                const Icon = s.icon;
                                const done = step > s.id;
                                const active = step === s.id;
                                return (
                                    <div key={s.id} className="flex items-center gap-1 flex-1">
                                        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
                                            active ? "bg-blue-600 text-white" :
                                            done   ? "bg-green-100 text-green-700" :
                                                     "text-slate-400"
                                        }`}>
                                            {done ? <CheckCircle className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                                            <span className="hidden sm:inline">{s.label}</span>
                                        </div>
                                        {idx < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />}
                                    </div>
                                );
                            })}
                        </div>

                        {/* ── Step Body ── */}
                        <div className="px-6 py-6 min-h-[280px]">

                            {/* Stage 1 — Commodity */}
                            {step === 1 && (
                                <div className="space-y-4">
                                    <div className="bg-blue-50 rounded-xl p-4 flex items-center justify-between">
                                        <div>
                                            <p className="text-xs text-blue-600 font-semibold uppercase">Commodity</p>
                                            <p className="font-bold text-slate-900 text-lg">{exportWindow.commodity}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-blue-600 font-semibold uppercase">Price/kg</p>
                                            <p className="font-bold text-primary text-lg">₦{exportWindow.slotPrice.toLocaleString()}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-blue-600 font-semibold uppercase">Available</p>
                                            <p className="font-bold text-slate-900 text-lg">{availableVolume.toLocaleString()}kg</p>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                                            Weight to book (kg) <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="number" min={1} max={availableVolume} value={volume}
                                            onChange={e => setVolume(parseInt(e.target.value) || 0)}
                                            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <p className="text-xs text-slate-500 mt-1">Max: {availableVolume.toLocaleString()}kg</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-xl p-4 flex items-center justify-between">
                                        <span className="font-semibold text-slate-700">Estimated Total</span>
                                        <span className="text-2xl font-bold text-primary">₦{totalPrice.toLocaleString()}</span>
                                    </div>
                                </div>
                            )}

                            {/* Stage 2 — Specs */}
                            {step === 2 && (
                                <div className="space-y-4">
                                    <p className="text-sm text-slate-500">Enter your cargo quality specifications for this shipment.</p>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-900 mb-1.5">Moisture Content (%) <span className="text-red-500">*</span></label>
                                            <input type="number" min={0} max={100} step={0.1} value={moisture}
                                                onChange={e => setMoisture(e.target.value)}
                                                placeholder="e.g. 6"
                                                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-900 mb-1.5">Foreign Matter (%) <span className="text-red-500">*</span></label>
                                            <input type="number" min={0} max={100} step={0.1} value={foreignMatter}
                                                onChange={e => setForeignMatter(e.target.value)}
                                                placeholder="e.g. 0.5"
                                                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                        </div>
                                    </div>
                                    <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${hasPhyto ? "border-green-500 bg-green-50" : "border-slate-200 hover:border-slate-300"}`}>
                                        <input type="checkbox" checked={hasPhyto} onChange={e => setHasPhyto(e.target.checked)} className="mt-0.5 w-4 h-4 accent-green-600" />
                                        <div>
                                            <p className="font-semibold text-slate-900 text-sm">I confirm I hold a valid <span className="text-green-700">Phytosanitary Certificate</span> <span className="text-red-500">*</span></p>
                                            <p className="text-xs text-slate-500 mt-0.5">Issued by NAQS or an accredited government agency. This is mandatory for international export clearance.</p>
                                        </div>
                                    </label>
                                </div>
                            )}

                            {/* Stage 3 — Logistics */}
                            {step === 3 && (
                                <div className="space-y-4">
                                    <p className="text-sm text-slate-500">Select your shipping terms and departure details.</p>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-2">Shipping Terms <span className="text-red-500">*</span></label>
                                        <div className="grid grid-cols-2 gap-3">
                                            {(["FOB", "CIF"] as const).map(t => (
                                                <button key={t} onClick={() => setShippingTerms(t)}
                                                    className={`p-4 rounded-xl border-2 text-left transition ${shippingTerms === t ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}>
                                                    <p className="font-bold text-slate-900">{t}</p>
                                                    <p className="text-xs text-slate-500 mt-0.5">{t === "FOB" ? "Free On Board — buyer pays freight" : "Cost, Insurance & Freight — seller covers"}</p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-1.5"><MapPin className="w-4 h-4 inline mr-1" />Port of Origin <span className="text-red-500">*</span></label>
                                        <select value={port} onChange={e => setPort(e.target.value)}
                                            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
                                            {PORTS.map(p => <option key={p} value={p}>{p}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-900 mb-1.5"><Ship className="w-4 h-4 inline mr-1" />Cargo Vessel <span className="text-red-500">*</span></label>
                                        <select value={vessel} onChange={e => setVessel(e.target.value)}
                                            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
                                            {VESSELS.map(v => <option key={v} value={v}>{v}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {/* Stage 4 — Documents */}
                            {step === 4 && (
                                <div className="space-y-4">
                                    <p className="text-sm text-slate-500">Upload your shipping documents for verification.</p>
                                    {[
                                        { label: "Bill of Lading", key: "bol", file: bolFile, ref: bolRef, setter: setBolFile },
                                        { label: "Certificate of Origin", key: "co",  file: coFile,  ref: coRef,  setter: setCoFile  },
                                    ].map(doc => (
                                        <div key={doc.key}>
                                            <label className="block text-sm font-semibold text-slate-900 mb-1.5">{doc.label} <span className="text-red-500">*</span></label>
                                            <div
                                                onClick={() => doc.ref.current?.click()}
                                                className={`flex items-center gap-3 p-4 rounded-xl border-2 border-dashed cursor-pointer transition ${doc.file ? "border-green-500 bg-green-50" : "border-slate-300 hover:border-blue-400 bg-slate-50"}`}
                                            >
                                                {doc.file ? (
                                                    <>
                                                        <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="font-semibold text-green-800 text-sm truncate">{doc.file.name}</p>
                                                            <p className="text-xs text-green-600">{(doc.file.size / 1024).toFixed(1)} KB</p>
                                                        </div>
                                                        <button onClick={e => { e.stopPropagation(); doc.setter(null); }} className="text-slate-400 hover:text-red-500 transition">
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Upload className="w-5 h-5 text-slate-400 shrink-0" />
                                                        <p className="text-sm text-slate-500">Click to upload <span className="font-semibold text-blue-600">{doc.label}</span></p>
                                                    </>
                                                )}
                                            </div>
                                            <input ref={doc.ref} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                                                onChange={e => { const f = e.target.files?.[0]; if (f) doc.setter(f); }} />
                                        </div>
                                    ))}
                                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                                        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                        <p className="text-xs text-amber-700">Accepted formats: PDF, JPG, PNG. Max file size: 5MB each. Documents must be clearly legible.</p>
                                    </div>
                                </div>
                            )}

                            {/* Stage 5 — Review & Confirm */}
                            {step === 5 && (
                                <div className="space-y-4">
                                    <p className="text-sm font-semibold text-slate-700 mb-2">Review your booking details before confirming.</p>
                                    <div className="bg-slate-50 rounded-xl divide-y divide-slate-200 text-sm">
                                        {[
                                            ["Window", exportWindow.title],
                                            ["Commodity", exportWindow.commodity],
                                            ["Volume", `${volume.toLocaleString()} kg`],
                                            ["Shipping Terms", shippingTerms],
                                            ["Port of Origin", port],
                                            ["Cargo Vessel", vessel],
                                            ["Moisture Content", `${moisture}%`],
                                            ["Foreign Matter", `${foreignMatter}%`],
                                            ["Phytosanitary Certificate", hasPhyto ? "✅ Confirmed" : "❌ Not confirmed"],
                                            ["Bill of Lading", bolFile?.name ?? ""],
                                            ["Certificate of Origin", coFile?.name ?? ""],
                                        ].map(([k, v]) => (
                                            <div key={k} className="flex justify-between px-4 py-2.5 gap-4">
                                                <span className="text-slate-500 shrink-0">{k}</span>
                                                <span className="font-semibold text-slate-900 text-right truncate max-w-[55%]">{v}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-between">
                                        <span className="font-bold text-slate-900">Total Amount</span>
                                        <span className="text-2xl font-bold text-primary">₦{totalPrice.toLocaleString()}</span>
                                    </div>
                                    <p className="text-xs text-slate-400 text-center">Payment details will be sent to your registered email after confirmation.</p>
                                </div>
                            )}
                        </div>

                        {/* ── Footer Actions ── */}
                        <div className="px-6 pb-6 flex gap-3">
                            {step > 1 && (
                                <button onClick={back} disabled={submitting}
                                    className="flex items-center gap-2 px-5 py-3 border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition disabled:opacity-50">
                                    <ChevronLeft className="w-4 h-4" /> Back
                                </button>
                            )}
                            <div className="flex-1" />
                            {step < 5 ? (
                                <button onClick={next}
                                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-lg shadow-blue-600/20">
                                    Next <ChevronRight className="w-4 h-4" />
                                </button>
                            ) : (
                                <button onClick={handleConfirm} disabled={submitting}
                                    className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition shadow-lg disabled:opacity-50">
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                    {submitting ? "Booking..." : "Pay & Confirm Slot"}
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
