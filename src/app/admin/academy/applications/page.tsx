"use client";

import { useState } from "react";
import {
    FileText, CheckCircle, XCircle, Loader2, Filter,
    Search, Eye, BookOpen, GraduationCap, DollarSign,
    X, User, Phone, Mail, MapPin, Briefcase, Calendar,
    Target, Award, Download
} from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import {
    approveAcademyApplicationAction,
    rejectAcademyApplicationAction,
    markAcademyApplicationUnderReviewAction
} from "@/app/actions/admin";
import EnrollStudentModal from "@/components/admin/EnrollStudentModal";
import { getStandardAcademyApplicationsAction, getAcademyStatsAction, logAcademyExportAction, updateAcademyApplicationPaymentAction } from "@/app/actions/academy-admin";
import { useAdminData } from "@/hooks/useAdminData";
import { useEffect } from "react";
import DateRangeFilter, { type DateRange } from "@/components/admin/DateRangeFilter";

// ─── Types ───────────────────────────────────────────────────────────────────
type ApplicationStatus = "pending" | "under_review" | "approved" | "rejected";

interface AcademyApplication {
    id: string;
    personalInfo: {
        fullName: string;
        firstName?: string;
        lastName?: string;
        otherName?: string;
        email: string;
        phone: string;
    };
    education?: {
        educationLevel?: string;
        fieldOfStudy?: string;
        yearsExperience?: number;
        currentRole?: string;
    };
    interests?: {
        learningPaths?: string[];
        topics?: string;
        goals?: string;
    };
    status: ApplicationStatus;
    submittedAt: string | null;
    reviewedAt?: string | null;
    rejectionReason?: string;
    paymentStatus?: string;
    paymentAmount?: number;
    plan?: string;
    paymentReference?: string | null;
    source?: string;
    // Extra merged fields from backend
    gender?: string;
    dateOfBirth?: string;
    occupation?: string;
    stateOfOrigin?: string;
    lga?: string;
    residentialAddress?: string;
    _raw?: any; // full merged data object
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toIso(ts: any): string | null {
    if (!ts) return null;
    if (ts?.toDate) return ts.toDate().toISOString();
    if (typeof ts === "string") return ts;
    return null;
}

function fmtDate(iso: string | null | undefined) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("en-NG", {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit"
    }).format(new Date(iso));
}

function planBadge(plan: string | undefined) {
    if (!plan) return null;
    const colors: Record<string, string> = {
        elite: "bg-purple-100 text-purple-700",
        advanced: "bg-blue-100 text-blue-700",
        standard: "bg-indigo-100 text-indigo-700",
        foundation: "bg-green-100 text-green-700",
        registration: "bg-slate-100 text-slate-600",
    };
    const label = plan.charAt(0).toUpperCase() + plan.slice(1);
    return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${colors[plan] ?? "bg-slate-100 text-slate-600"}`}>
            {label}
        </span>
    );
}

const statusColor = (s: ApplicationStatus) => ({
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    under_review: "bg-blue-100 text-blue-700",
    pending: "bg-yellow-100 text-yellow-700",
}[s] ?? "bg-slate-100 text-slate-600");

// ─── Detail Modal ─────────────────────────────────────────────────────────────

const Row = ({ label, value }: { label: string; value?: string | number | null }) => (
    value ? (
        <div className="flex flex-col sm:flex-row sm:items-start gap-1 py-2 border-b border-slate-100 last:border-0">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide sm:w-44 shrink-0">{label}</span>
            <span className="text-sm text-slate-800 font-medium">{String(value)}</span>
        </div>
    ) : null
);

function ApplicationDetailModal({
    app,
    onClose,
    onApprove,
    onReject,
    onReview,
    onUpdatePayment,
    processingId,
}: {
    app: AcademyApplication;
    onClose: () => void;
    onApprove: (id: string) => void;
    onReject: (id: string) => void;
    onReview: (id: string) => void;
    onUpdatePayment: (id: string, status: "pending" | "completed" | "paid", amount: number, plan: string) => void;
    processingId: string | null;
}) {
    const [isUpdatingPayment, setIsUpdatingPayment] = useState(false);
    const [paymentForm, setPaymentForm] = useState({
        status: app.paymentStatus === "completed" || app.paymentStatus === "paid" ? "completed" : "pending",
        amount: app.paymentAmount || 0,
        plan: app.plan || "registration",
    });

    const d = app._raw || {};
    const pi = d.personalInfo || {};
    const edu = d.education || app.education || {};
    const interests = d.interests || app.interests || {};

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <GraduationCap className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">{app.personalInfo.fullName}</h2>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${statusColor(app.status)}`}>
                                {app.status.replace("_", " ")}
                            </span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition">
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-6">
                    {/* Personal Info */}
                    <section>
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
                            <User className="w-4 h-4" /> Personal Information
                        </h3>
                        <div className="bg-slate-50 rounded-xl px-4 py-2">
                            <Row label="Full Name" value={app.personalInfo.fullName} />
                            <Row label="Email" value={app.personalInfo.email} />
                            <Row label="Phone" value={app.personalInfo.phone || d.phone} />
                            <Row label="Gender" value={d.gender || app.gender} />
                            <Row label="Date of Birth" value={d.dateOfBirth || app.dateOfBirth} />
                            <Row label="Occupation" value={d.occupation || pi.occupation || app.occupation} />
                            <Row label="State" value={d.stateOfOrigin || pi.stateOfOrigin || pi.state || app.stateOfOrigin} />
                            <Row label="LGA" value={d.lga || pi.lga || app.lga} />
                            <Row label="Address" value={d.residentialAddress || pi.residentialAddress || app.residentialAddress} />
                        </div>
                    </section>

                    {/* Education */}
                    <section>
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
                            <BookOpen className="w-4 h-4" /> Education & Background
                        </h3>
                        <div className="bg-slate-50 rounded-xl px-4 py-2">
                            <Row label="Education Level" value={edu.educationLevel} />
                            <Row label="Field of Study" value={edu.fieldOfStudy} />
                            <Row label="Years Experience" value={edu.yearsExperience != null ? `${edu.yearsExperience} years` : undefined} />
                            <Row label="Current Role" value={edu.currentRole} />
                        </div>
                    </section>

                    {/* Interests & Goals */}
                    <section>
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
                            <Target className="w-4 h-4" /> Learning Interests & Goals
                        </h3>
                        <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-3">
                            {interests.learningPaths?.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Learning Paths</p>
                                    <div className="flex flex-wrap gap-2">
                                        {interests.learningPaths.map((p: string) => (
                                            <span key={p} className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">{p}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {interests.topics && (
                                <div>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Topics of Interest</p>
                                    <p className="text-sm text-slate-700">{interests.topics}</p>
                                </div>
                            )}
                            {interests.goals && (
                                <div>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Goals</p>
                                    <p className="text-sm text-slate-700">{interests.goals}</p>
                                </div>
                            )}
                            {!interests.goals && !interests.topics && (!interests.learningPaths?.length) && (
                                <p className="text-sm text-slate-400 italic">Not provided</p>
                            )}
                        </div>
                    </section>

                    {/* Payment */}
                    <section>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wider">
                                <DollarSign className="w-4 h-4" /> Payment Details
                            </h3>
                            <button
                                onClick={() => setIsUpdatingPayment(!isUpdatingPayment)}
                                className="text-xs font-semibold text-blue-600 hover:text-blue-700 transition px-2 py-1 rounded hover:bg-blue-50"
                            >
                                {isUpdatingPayment ? "Cancel Edit" : "Edit Payment"}
                            </button>
                        </div>
                        
                        {isUpdatingPayment ? (
                            <div className="bg-blue-50 rounded-xl px-4 py-3 border border-blue-100">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Status</label>
                                        <select 
                                            value={paymentForm.status} 
                                            onChange={e => setPaymentForm(p => ({ ...p, status: e.target.value as any }))}
                                            className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
                                        >
                                            <option value="pending">Pending / Unpaid</option>
                                            <option value="completed">Completed / Paid</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Amount Paid (₦)</label>
                                        <input 
                                            type="number"
                                            value={paymentForm.amount} 
                                            onChange={e => setPaymentForm(p => ({ ...p, amount: Number(e.target.value) }))}
                                            className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
                                        />
                                    </div>
                                    <div className="sm:col-span-2">
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Plan Enrolled</label>
                                        <select 
                                            value={paymentForm.plan} 
                                            onChange={e => setPaymentForm(p => ({ ...p, plan: e.target.value }))}
                                            className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm"
                                        >
                                            <option value="registration">Registration Only</option>
                                            <option value="foundation">Foundation</option>
                                            <option value="standard">Standard</option>
                                            <option value="advanced">Advanced</option>
                                            <option value="elite">Elite</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => onUpdatePayment(app.id, paymentForm.status as any, paymentForm.amount, paymentForm.plan)}
                                        disabled={!!processingId}
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {processingId === app.id + "_payment" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                                        Save Payment
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-slate-50 rounded-xl px-4 py-2">
                                <Row label="Plan" value={app.plan} />
                                <Row label="Payment Status" value={app.paymentStatus} />
                                <Row label="Amount Paid" value={app.paymentAmount != null ? `₦${app.paymentAmount.toLocaleString()}` : undefined} />
                                <Row label="Reference" value={app.paymentReference ?? undefined} />
                                <Row label="Source" value={app.source} />
                            </div>
                        )}
                    </section>

                    {/* Meta */}
                    <section>
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
                            <Calendar className="w-4 h-4" /> Application Meta
                        </h3>
                        <div className="bg-slate-50 rounded-xl px-4 py-2">
                            <Row label="Application ID" value={app.id} />
                            <Row label="Submitted" value={fmtDate(app.submittedAt)} />
                            <Row label="Reviewed" value={fmtDate(app.reviewedAt)} />
                            {app.rejectionReason && <Row label="Rejection Reason" value={app.rejectionReason} />}
                        </div>
                    </section>
                </div>

                {/* Action Footer */}
                <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex flex-wrap gap-3 justify-end rounded-b-2xl">
                    <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition">
                        Close
                    </button>
                    {(app.status === "pending" || app.status === "under_review") && (
                        <>
                            <button
                                onClick={() => onReject(app.id)}
                                disabled={!!processingId}
                                className="px-4 py-2 rounded-xl border border-red-300 text-red-700 font-semibold hover:bg-red-50 transition disabled:opacity-50 flex items-center gap-2"
                            >
                                {processingId === app.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                                Reject
                            </button>
                            {app.status === "pending" && (
                                <button
                                    onClick={() => onReview(app.id)}
                                    disabled={!!processingId}
                                    className="px-4 py-2 rounded-xl border border-amber-400 text-amber-700 font-semibold hover:bg-amber-50 transition disabled:opacity-50 flex items-center gap-2"
                                >
                                    {processingId === app.id + "_review" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                                    Mark Under Review
                                </button>
                            )}
                            <button
                                onClick={() => onApprove(app.id)}
                                disabled={!!processingId}
                                className="px-4 py-2 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-2"
                            >
                                {processingId === app.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                Approve
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AdminAcademyApplicationsPage() {
    const { showToast } = useToast();
    const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
    const [paymentFilter, setPaymentFilter] = useState<"all" | "completed" | "pending">("all");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [search, setSearch] = useState("");
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);
    const [selectedApp, setSelectedApp] = useState<AcademyApplication | null>(null);
    const [stats, setStats] = useState<{ totalApplications: number; pending: number; under_review: number; approved: number; rejected: number; } | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [dateRange, setDateRange] = useState<DateRange>({ from: "", to: "" });

    useEffect(() => {
        getAcademyStatsAction().then(res => {
            if (res.success && res.data?.stats) {
                setStats(res.data.stats);
            }
        });
    }, []);

    const {
        data: applications,
        loading: isLoading,
        hasMore,
        refresh: fetchData,
        onNextPage,
        onPrevPage,
        pageIndex
    } = useAdminData<AcademyApplication>({
        fetchAction: async (opts) => {
            try {
                const result = await getStandardAcademyApplicationsAction({
                    limit: opts.limit || 50,
                    lastDocId: opts.lastDocId,
                    search: search.trim() ? search : undefined,
                    status: statusFilter === "all" ? undefined : statusFilter,
                    sortOrder: sortOrder,
                    dateFrom: dateRange.from || undefined,
                    dateTo: dateRange.to || undefined,
                });

                if (!result.success) {
                    showToast(result.error || "Failed to load applications", "error");
                    return { success: false, data: [], meta: { hasMore: false }, error: result.error };
                }

                const apps = (result.data ?? []).map((stdApp: any) => {
                    const d = stdApp.data;
                    const pi = d.personalInfo || {};
                    return {
                        id: stdApp.id,
                        personalInfo: {
                            fullName: stdApp.user.name,
                            firstName: pi.firstName,
                            lastName: pi.lastName,
                            otherName: pi.otherName,
                            email: stdApp.user.email,
                            phone: pi.phone ?? d.phone ?? stdApp.user.phone ?? "",
                        },
                        education: d.education,
                        interests: d.interests,
                        status: stdApp.status,
                        submittedAt: toIso(d.submittedAt || d.createdAt),
                        reviewedAt: toIso(d.reviewedAt),
                        rejectionReason: d.rejectionReason,
                        paymentStatus: d.paymentStatus,
                        paymentAmount: d.paymentAmount ? Number(d.paymentAmount) : undefined,
                        plan: d.plan,
                        paymentReference: d.paymentReference,
                        source: d.source,
                        gender: d.gender,
                        dateOfBirth: d.dateOfBirth,
                        occupation: d.occupation,
                        stateOfOrigin: d.stateOfOrigin,
                        lga: d.lga,
                        residentialAddress: d.residentialAddress,
                        _raw: d, // keep full merged object for the detail modal
                    } as AcademyApplication;
                });

                return {
                    success: true,
                    data: apps,
                    meta: {
                        lastDocId: result.lastDocId,
                        hasMore: result.hasMore
                    }
                };
            } catch (err: any) {
                return { success: false, data: [], meta: { hasMore: false }, error: err.message };
            }
        },
        limit: 50,
        dependencies: [statusFilter, search, sortOrder, dateRange]
    });

    async function handleApprove(id: string) {
        setProcessingId(id);
        const result = await approveAcademyApplicationAction(id);
        if (result.success) {
            showToast("Application approved", "success");
            setSelectedApp(null);
            await fetchData();
        } else {
            showToast(result.error || "Failed to approve", "error");
        }
        setProcessingId(null);
    }

    async function handleReject(id: string) {
        const reason = prompt("Enter rejection reason:");
        if (!reason) return;
        setProcessingId(id);
        const result = await rejectAcademyApplicationAction(id, reason);
        if (result.success) {
            showToast("Application rejected", "success");
            setSelectedApp(null);
            await fetchData();
        } else {
            showToast(result.error || "Failed to reject", "error");
        }
        setProcessingId(null);
    }

    async function handleMarkUnderReview(id: string) {
        setProcessingId(id + "_review");
        const result = await markAcademyApplicationUnderReviewAction(id);
        if (result.success) {
            showToast("Application marked under review", "success");
            setSelectedApp(null);
            await fetchData();
        } else {
            showToast(result.error || "Failed to mark under review", "error");
        }
        setProcessingId(null);
    }

    async function handleUpdatePayment(id: string, status: "pending" | "completed" | "paid", amount: number, plan: string) {
        setProcessingId(id + "_payment");
        const result = await updateAcademyApplicationPaymentAction(id, status, amount, plan);
        if (result.success) {
            showToast("Payment details updated", "success");
            setSelectedApp(null);
            await fetchData();
        } else {
            showToast(result.error || "Failed to update payment", "error");
        }
        setProcessingId(null);
    }

    const filtered = applications.filter(a => {
        if (paymentFilter === "all") return true;
        if (paymentFilter === "completed") return a.paymentStatus === "completed" || a.paymentStatus === "paid";
        return a.paymentStatus !== "completed" && a.paymentStatus !== "paid";
    });

    const counts = stats ? {
        pending: stats.pending,
        under_review: stats.under_review,
        approved: stats.approved,
        rejected: stats.rejected
    } : { pending: 0, under_review: 0, approved: 0, rejected: 0 };
    
    // If stats are not yet loaded, fallback to computing from the fetched data
    if (!stats) {
        applications.forEach(a => { counts[a.status] = (counts[a.status] ?? 0) + 1; });
    }

    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [exportConfig, setExportConfig] = useState({
        status: "all" as ApplicationStatus | "all",
        payment: "all" as "all" | "completed" | "pending",
        limit: 5000,
    });

    const handleExportCSV = async (config: typeof exportConfig) => {
        setIsExportModalOpen(false);
        setIsExporting(true);
        showToast("Preparing export...", "success");
        try {
            const result = await getStandardAcademyApplicationsAction({
                limit: config.limit,
                search: search.trim() ? search : undefined,
                status: config.status === "all" ? undefined : config.status
            });

            if (!result.success || !result.data) {
                showToast("Failed to fetch data for export", "error");
                return;
            }

            let exportApps = result.data.map((stdApp: any) => {
                const d = stdApp.data;
                const pi = d.personalInfo || {};
                return {
                    id: stdApp.id,
                    personalInfo: {
                        fullName: stdApp.user.name,
                        email: stdApp.user.email,
                        phone: pi.phone ?? d.phone ?? stdApp.user.phone ?? "",
                    },
                    status: stdApp.status,
                    submittedAt: d.submittedAt || d.createdAt,
                    paymentStatus: d.paymentStatus,
                    paymentAmount: d.paymentAmount ? Number(d.paymentAmount) : 0,
                    plan: d.plan,
                    stateOfOrigin: d.stateOfOrigin,
                    lga: d.lga,
                };
            });

            // Apply payment filter just like the UI
            exportApps = exportApps.filter((a: any) => {
                if (config.payment === "all") return true;
                if (config.payment === "completed") return a.paymentStatus === "completed" || a.paymentStatus === "paid";
                return a.paymentStatus !== "completed" && a.paymentStatus !== "paid";
            });

            const headers = [
                "Application ID", "Full Name", "Email", "Phone",
                "Status", "Payment Status", "Amount Paid", "Plan",
                "State", "LGA", "Submitted At"
            ];
            const rows = exportApps.map((app: any) => [
                app.id,
                app.personalInfo.fullName || "",
                app.personalInfo.email || "",
                app.personalInfo.phone || "",
                app.status,
                app.paymentStatus || "unpaid",
                app.paymentAmount || 0,
                app.plan || "",
                app.stateOfOrigin || "",
                app.lga || "",
                app.submittedAt ? new Date(app.submittedAt).toLocaleDateString("en-NG") : ""
            ]);
            const csvContent = [
                headers.join(","),
                ...rows.map((row: any) => row.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(","))
            ].join("\n");
            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `academy_applications_${config.status}_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            // Log audit action
            await logAcademyExportAction({
                count: exportApps.length,
                filters: { status: config.status, search, payment: config.payment }
            });
            
            showToast(`Exported ${exportApps.length} applications`, "success");
        } catch (error) {
            console.error(error);
            showToast("Failed to export applications", "error");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-8">
            {/* Header */}
            <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 mb-1">Academy Applications</h1>
                    <p className="text-slate-600">Live — {stats ? stats.totalApplications.toLocaleString() : applications.length} total applications</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {filtered.length > 0 && (
                        <button
                            onClick={() => {
                                setExportConfig({
                                    status: statusFilter,
                                    payment: paymentFilter,
                                    limit: 5000
                                });
                                setIsExportModalOpen(true);
                            }}
                            disabled={isExporting}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-semibold transition shadow-sm border border-slate-700 flex items-center gap-2 disabled:opacity-50"
                        >
                            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            {isExporting ? "Exporting..." : "Export CSV"}
                        </button>
                    )}
                    <button
                        onClick={() => setIsEnrollModalOpen(true)}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition shadow-sm border border-blue-500"
                    >
                        + Add Student
                    </button>
                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                        <span className="text-sm font-semibold text-green-700">Live</span>
                    </div>
                </div>
            </div>

            {/* Status Summary Tabs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {(["pending", "under_review", "approved", "rejected"] as const).map(s => (
                    <button
                        key={s}
                        onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                        className={`rounded-xl p-4 text-left transition border bg-white border-slate-200 ${statusFilter === s ? "ring-2 ring-blue-500" : ""}`}
                    >
                        <p className="text-2xl font-bold text-slate-900">{counts[s]}</p>
                        <p className={`text-xs font-semibold capitalize px-2 py-0.5 rounded-full inline-block mt-1 ${statusColor(s)}`}>
                            {s.replace("_", " ")}
                        </p>
                    </button>
                ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4 mb-6">
                <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-slate-500" />
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value as ApplicationStatus | "all")}
                        className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm"
                    >
                        <option value="all">All Applications</option>
                        <option value="pending">Pending</option>
                        <option value="under_review">Under Review</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-slate-500" />
                    <select
                        value={paymentFilter}
                        onChange={e => setPaymentFilter(e.target.value as any)}
                        className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm"
                    >
                        <option value="all">Any Payment Status</option>
                        <option value="completed">Paid</option>
                        <option value="pending">Unpaid</option>
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-500" />
                    <select
                        value={sortOrder}
                        onChange={e => setSortOrder(e.target.value as any)}
                        className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm"
                    >
                        <option value="desc">Newest First</option>
                        <option value="asc">Oldest First</option>
                    </select>
                </div>
                <DateRangeFilter
                    value={dateRange}
                    onChange={setDateRange}
                    label="Filter by date"
                />
                <div className="relative flex-1 max-w-sm">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        placeholder="Search by name, email, phone…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>
                <span className="text-sm text-slate-500">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
            </div>


            {/* Loading */}
            {isLoading && applications.length === 0 && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
            )}

            {/* Application Cards */}
            {!isLoading && applications.length > 0 && (
                <div className="space-y-3">
                    {filtered.map(app => (
                        <div key={app.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:border-blue-200 hover:shadow-md transition">
                            <div className="flex items-start justify-between flex-wrap gap-3">
                                <div className="flex items-start gap-4 flex-1 min-w-0">
                                    <div className="w-11 h-11 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                                        <GraduationCap className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="text-base font-bold text-slate-900">{app.personalInfo.fullName}</h3>
                                            {planBadge(app.plan)}
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${statusColor(app.status)}`}>
                                                {app.status.replace("_", " ")}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-500 truncate">
                                            {app.personalInfo.email}
                                            {app.personalInfo.phone ? ` • ${app.personalInfo.phone}` : ""}
                                        </p>
                                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                                            {app.education?.educationLevel && (
                                                <span className="text-xs text-slate-500">{app.education.educationLevel}</span>
                                            )}
                                            {app.paymentAmount != null && (
                                                <span className="text-xs text-green-700 font-semibold">₦{app.paymentAmount.toLocaleString()} paid</span>
                                            )}
                                            <span className="text-xs text-slate-400">{fmtDate(app.submittedAt)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    {/* View Details */}
                                    <button
                                        onClick={() => setSelectedApp(app)}
                                        className="px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 text-sm font-semibold hover:bg-blue-50 transition flex items-center gap-1.5"
                                    >
                                        <Eye className="w-4 h-4" /> View
                                    </button>

                                    {/* Quick Actions */}
                                    {app.status === "pending" && (
                                        <>
                                            <button
                                                onClick={() => handleMarkUnderReview(app.id)}
                                                disabled={!!processingId}
                                                className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-sm font-semibold hover:bg-amber-50 transition disabled:opacity-50"
                                            >
                                                Review
                                            </button>
                                            <button
                                                onClick={() => handleApprove(app.id)}
                                                disabled={!!processingId}
                                                className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-1"
                                            >
                                                {processingId === app.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                                                Approve
                                            </button>
                                        </>
                                    )}
                                    {app.status === "under_review" && (
                                        <button
                                            onClick={() => handleApprove(app.id)}
                                            disabled={!!processingId}
                                            className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-1"
                                        >
                                            {processingId === app.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                                            Approve
                                        </button>
                                    )}
                                </div>
                            </div>

                            {app.rejectionReason && (
                                <p className="mt-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">
                                    Rejection reason: {app.rejectionReason}
                                </p>
                            )}
                        </div>
                    ))}

                    {filtered.length === 0 && (
                        <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-slate-200">
                            <BookOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-slate-900 mb-2">No Applications Found</h3>
                            <p className="text-slate-600">
                                {search ? `No results for "${search}"` :
                                    statusFilter !== "all" ? `No ${statusFilter.replace("_", " ")} applications` :
                                        "No academy applications yet"}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Empty State */}
            {!isLoading && applications.length === 0 && (
                <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-slate-200">
                    <BookOpen className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-slate-900 mb-2">No Applications Yet</h3>
                    <p className="text-slate-600">Academy applications will appear here once submitted.</p>
                </div>
            )}

            {/* Pagination */}
            {!isLoading && applications.length > 0 && (
                <div className="flex items-center justify-between mt-6 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-sm font-medium text-slate-500">Page {pageIndex + 1}</span>
                    <div className="flex gap-2">
                        <button
                            onClick={onPrevPage}
                            disabled={pageIndex === 0 || isLoading}
                            className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
                        >
                            Previous
                        </button>
                        <button
                            onClick={onNextPage}
                            disabled={!hasMore || isLoading}
                            className="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition flex items-center gap-2"
                        >
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : "Next Page"}
                        </button>
                    </div>
                </div>
            )}

            {/* Detail Modal */}
            {selectedApp && (
                <ApplicationDetailModal
                    app={selectedApp}
                    onClose={() => setSelectedApp(null)}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onReview={handleMarkUnderReview}
                    onUpdatePayment={handleUpdatePayment}
                    processingId={processingId}
                />
            )}

            {/* Enroll Student Modal */}
            <EnrollStudentModal
                isOpen={isEnrollModalOpen}
                onClose={() => setIsEnrollModalOpen(false)}
            />
            {/* Export Settings Modal */}
            {isExportModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between p-5 border-b border-slate-100">
                            <h3 className="font-bold text-lg flex items-center gap-2">
                                <Download className="w-5 h-5 text-slate-500" />
                                Export Applications
                            </h3>
                            <button onClick={() => setIsExportModalOpen(false)} className="p-1 hover:bg-slate-100 rounded-lg transition text-slate-500">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">Status Filter</label>
                                <select
                                    value={exportConfig.status}
                                    onChange={(e) => setExportConfig(c => ({ ...c, status: e.target.value as any }))}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm"
                                >
                                    <option value="all">All Statuses</option>
                                    <option value="pending">Pending</option>
                                    <option value="under_review">Under Review</option>
                                    <option value="approved">Approved</option>
                                    <option value="rejected">Rejected</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">Payment Status</label>
                                <select
                                    value={exportConfig.payment}
                                    onChange={(e) => setExportConfig(c => ({ ...c, payment: e.target.value as any }))}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm"
                                >
                                    <option value="all">Any Payment Status</option>
                                    <option value="completed">Paid / Completed</option>
                                    <option value="pending">Unpaid / Pending</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">Export Limit</label>
                                <select
                                    value={exportConfig.limit}
                                    onChange={(e) => setExportConfig(c => ({ ...c, limit: Number(e.target.value) }))}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm"
                                >
                                    <option value={5000}>All Available (Up to 5,000)</option>
                                    <option value={1000}>Latest 1,000</option>
                                    <option value={500}>Latest 500</option>
                                    <option value={100}>Latest 100</option>
                                </select>
                                <p className="text-xs text-slate-500 mt-2">
                                    The active search term "{search || 'none'}" will also be applied to this export.
                                </p>
                            </div>
                        </div>
                        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button
                                onClick={() => setIsExportModalOpen(false)}
                                className="px-4 py-2 font-medium text-slate-600 hover:text-slate-800 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleExportCSV(exportConfig)}
                                className="px-5 py-2 font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition shadow-sm flex items-center gap-2"
                            >
                                <Download className="w-4 h-4" />
                                Export CSV
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
