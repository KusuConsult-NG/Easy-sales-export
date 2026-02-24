"use client";

import { useState, useEffect, useCallback } from "react";
import { Shield, Trash2, Clock, CheckCircle, XCircle, Search, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";

interface PasswordResetRecord {
    id: string;
    email: string;
    used: boolean;
    usedAt?: string;
    expiry: number;
    createdAt: string;
}

export default function AdminPasswordResetsPage() {
    const { showToast } = useToast();
    const [records, setRecords] = useState<PasswordResetRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [purging, setPurging] = useState(false);

    const fetchRecords = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/admin/password-resets");
            const data = await res.json();
            if (data.success) {
                setRecords(data.records);
            } else {
                setError(data.error || "Failed to load records");
            }
        } catch {
            setError("Failed to fetch password reset records");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRecords();
    }, [fetchRecords]);

    const handlePurgeExpired = async () => {
        if (!confirm("Purge all expired & used reset tokens? This cannot be undone.")) return;
        setPurging(true);
        try {
            const res = await fetch("/api/admin/password-resets", { method: "DELETE" });
            const data = await res.json();
            if (data.success) {
                showToast(`Purged ${data.deleted} expired tokens`, "success");
                fetchRecords();
            } else {
                showToast(data.error || "Purge failed", "error");
            }
        } catch {
            showToast("Failed to purge tokens", "error");
        } finally {
            setPurging(false);
        }
    };

    const filtered = records.filter(r =>
        !search || r.email.toLowerCase().includes(search.toLowerCase())
    );

    const expired = records.filter(r => Date.now() > r.expiry).length;
    const used = records.filter(r => r.used).length;
    const active = records.filter(r => !r.used && Date.now() <= r.expiry).length;

    const formatDate = (d: string | number) =>
        new Intl.DateTimeFormat("en-NG", {
            dateStyle: "medium", timeStyle: "short"
        }).format(new Date(d));

    const isExpired = (expiry: number) => Date.now() > expiry;

    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <Shield className="w-8 h-8 text-primary" />
                    <h1 className="text-3xl font-bold text-slate-900">Password Resets</h1>
                </div>
                <p className="text-slate-600">Monitor and manage password reset tokens</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                {[
                    { label: "Total Tokens", value: records.length, icon: Shield, color: "blue" },
                    { label: "Active", value: active, icon: CheckCircle, color: "green" },
                    { label: "Used", value: used, icon: XCircle, color: "slate" },
                    { label: "Expired", value: expired, icon: Clock, color: "red" },
                ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className={`bg-${color}-50 border border-${color}-200 rounded-xl p-5`}>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className={`text-sm text-${color}-600 mb-1`}>{label}</p>
                                <p className={`text-3xl font-bold text-${color}-700`}>{value}</p>
                            </div>
                            <Icon className={`w-10 h-10 text-${color}-400 opacity-50`} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Controls */}
            <div className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search by email..."
                        className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                </div>
                <button
                    onClick={handlePurgeExpired}
                    disabled={purging || (expired + used === 0)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
                >
                    {purging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Purge Expired & Used
                </button>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl shadow overflow-hidden">
                {isLoading ? (
                    <div className="p-12 text-center">
                        <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-3" />
                        <p className="text-slate-500">Loading records...</p>
                    </div>
                ) : error ? (
                    <div className="p-8 flex items-center gap-3 text-red-600">
                        <AlertCircle className="w-5 h-5 shrink-0" />
                        <p>{error}</p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center">
                        <Shield className="w-14 h-14 text-slate-200 mx-auto mb-3" />
                        <p className="text-slate-500">No records found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {["Email", "Status", "Created", "Expires", "Used At"].map(h => (
                                        <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filtered.map(r => {
                                    const exp = isExpired(r.expiry);
                                    const status = r.used ? "used" : exp ? "expired" : "active";
                                    const badge = {
                                        used: "bg-slate-100 text-slate-600",
                                        expired: "bg-red-100 text-red-700",
                                        active: "bg-green-100 text-green-700",
                                    }[status];
                                    return (
                                        <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-5 py-3.5 text-sm font-medium text-slate-900">{r.email}</td>
                                            <td className="px-5 py-3.5">
                                                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${badge}`}>
                                                    {status}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3.5 text-sm text-slate-500">{formatDate(r.createdAt)}</td>
                                            <td className="px-5 py-3.5 text-sm text-slate-500">{formatDate(r.expiry)}</td>
                                            <td className="px-5 py-3.5 text-sm text-slate-500">
                                                {r.usedAt ? formatDate(r.usedAt) : "—"}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
