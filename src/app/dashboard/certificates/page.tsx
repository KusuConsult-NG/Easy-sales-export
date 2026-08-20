"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { Upload, Download, Trash2, FileText, Loader2, Plus, Award, GraduationCap, ExternalLink } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useToast } from "@/contexts/ToastContext";
import { useStorage } from "@/hooks/use-storage";

interface Certificate {
    id: string;
    userId: string;
    fileName: string;
    fileUrl: string;
    fileType: string;
    uploadedBy: string;
    uploadedAt: Date;
}

interface AcademyCertificate {
    id: string;
    courseName: string;
    courseId: string;
    issuedAt: Date;
    certificateUrl?: string;
    /** Where to open it. Supplied by the route — see the View link below. */
    viewUrl?: string;
    grade?: string;
}

type Tab = "academy" | "uploaded";

export default function CertificatesPage() {
    const { data: session } = useSession();
    const { showToast } = useToast();
    const { uploadFile, uploadState } = useStorage();
    const [activeTab, setActiveTab] = useState<Tab>("academy");
    const [certificates, setCertificates] = useState<Certificate[]>([]);
    const [academyCerts, setAcademyCerts] = useState<AcademyCertificate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);

    useEffect(() => {
        fetchAll();
    }, []);

    async function fetchAll() {
        setIsLoading(true);
        try {
            const [certsRes, acRes] = await Promise.all([
                fetch("/api/certificates"),
                fetch("/api/academy/certificates"),
            ]);
            const certsData = await certsRes.json();
            if (certsData.success) setCertificates(certsData.certificates || []);

            // `data.certificates`, which is what the route returns — and has
            // returned since it grew a cursor. This read `acData.certificates`,
            // a key that is not in the payload, so the Academy tab was set to
            // [] on every load regardless of what came back. Two independent
            // reasons the tab was empty: the route was querying a state nothing
            // wrote, and this would have discarded the answer anyway.
            //
            // /api/certificates above returns its list at the top level, which
            // is where this shape came from.
            const acData = await acRes.json();
            if (acData.success) setAcademyCerts(acData.data?.certificates || []);
        } catch (error) {
            logger.error("Failed to fetch certificates:", error);
        } finally {
            setIsLoading(false);
        }
    };

    async function fetchCertificates() {
        try {
            const response = await fetch("/api/certificates");
            const data = await response.json();
            if (data.success) setCertificates(data.certificates || []);
        } catch (error) {
            logger.error("Failed to fetch certificates:", error);
        }
    };

    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
        if (!allowedTypes.includes(file.type)) {
            showToast("Only PDF and images are allowed", "error");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            showToast("File size must be less than 5MB", "error");
            return;
        }

        setIsUploading(true);
        setUploadingFileName(file.name);
        try {
            // Client-side Cloudinary pre-upload
            const fileUrl = await uploadFile(file, `certificates/${session?.user?.id || "anonymous"}/${Date.now()}_${file.name}`);

            const response = await fetch("/api/certificates/upload", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    fileUrl,
                    fileName: file.name,
                    fileType: file.type,
                }),
            });

            const data = await response.json();
            if (data.success) {
                showToast("Certificate uploaded successfully", "success");
                fetchCertificates();
            } else {
                showToast(data.error || "Upload failed", "error");
            }
        } catch (error) {
            logger.error("Upload error:", error);
            showToast("Upload failed", "error");
        } finally {
            setIsUploading(false);
            setUploadingFileName(null);
        }
    };

    async function handleDownload(certificate: Certificate) {
        try {
            const response = await fetch(`/api/certificates/download?id=${certificate.id}`);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = certificate.fileName;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch {
            showToast("Download failed", "error");
        }
    };

    async function handleDelete(id: string) {
        if (!confirm("Are you sure you want to delete this certificate?")) return;
        try {
            const response = await fetch(`/api/certificates/${id}`, { method: "DELETE" });
            const data = await response.json();
            if (data.success) {
                showToast("Certificate deleted", "success");
                fetchCertificates();
            } else {
                showToast("Delete failed", "error");
            }
        } catch {
            showToast("Delete failed", "error");
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900">My Certificates</h1>
                    <p className="text-slate-600 mt-2">
                        Academy earned certificates and your personally uploaded documents
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-slate-200 p-1 rounded-xl mb-6 w-fit">
                    <button
                        onClick={() => setActiveTab("academy")}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === "academy"
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-600 hover:text-slate-900"
                            }`}
                    >
                        <GraduationCap className="w-4 h-4" />
                        Academy Earned
                        {academyCerts.length > 0 && (
                            <span className="bg-emerald-100 text-emerald-700 text-xs px-1.5 py-0.5 rounded-full font-bold">
                                {academyCerts.length}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab("uploaded")}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === "uploaded"
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-600 hover:text-slate-900"
                            }`}
                    >
                        <Upload className="w-4 h-4" />
                        Uploaded Docs
                        {certificates.length > 0 && (
                            <span className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full font-bold">
                                {certificates.length}
                            </span>
                        )}
                    </button>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-24">
                        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
                    </div>
                ) : activeTab === "academy" ? (
                    /* ── Academy Earned Certificates ─────────────────────────────── */
                    <div className="bg-white rounded-2xl p-6 shadow-xl">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                <Award className="w-5 h-5 text-amber-500" />
                                Academy Certificates ({academyCerts.length})
                            </h2>
                            <Link
                                href="/academy/dashboard"
                                className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                            >
                                Go to Academy <ExternalLink className="w-3 h-3" />
                            </Link>
                        </div>

                        {academyCerts.length === 0 ? (
                            <div className="text-center py-12">
                                <GraduationCap className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                                <p className="text-slate-600 font-medium mb-2">No Academy certificates yet</p>
                                <p className="text-sm text-slate-400 mb-6">
                                    Complete courses in the Academy to earn verifiable certificates
                                </p>
                                <Link
                                    href="/academy/courses"
                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition text-sm"
                                >
                                    Browse Courses
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {academyCerts.map((cert) => (
                                    <div
                                        key={cert.id}
                                        className="flex items-center justify-between p-4 border border-amber-200 bg-amber-50 rounded-xl"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                                                <Award className="w-6 h-6 text-amber-600" />
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-slate-900">{cert.courseName}</h3>
                                                <p className="text-sm text-slate-500">
                                                    Issued {new Date(cert.issuedAt).toLocaleDateString()}
                                                    {cert.grade && <span className="ml-2 text-emerald-600 font-medium">· {cert.grade}</span>}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {cert.certificateUrl && (
                                                <a
                                                    href={cert.certificateUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition font-semibold"
                                                >
                                                    <Download className="w-4 h-4" />
                                                    Download
                                                </a>
                                            )}
                                            {/* The route says where it opens.
                                                This built `/academy/certificate/${cert.id}`
                                                from the DOCUMENT id, and that
                                                page reads its segment as a
                                                COURSE id — so View led to a page
                                                that could not resolve a course.
                                                WAVE rows have no such page and
                                                now show no View button rather
                                                than a broken one. */}
                                            {cert.viewUrl && (
                                                <a
                                                    href={cert.viewUrl}
                                                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition font-semibold"
                                                >
                                                    <ExternalLink className="w-4 h-4" />
                                                    View
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    /* ── Uploaded Documents ─────────────────────────────────────── */
                    <div>
                        {/* Upload Section */}
                        <div className="bg-white rounded-2xl p-6 mb-6 shadow-xl">
                            <h2 className="text-xl font-bold text-slate-900 mb-4">Upload Certificate</h2>
                            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-8 cursor-pointer hover:border-blue-500 transition">
                                <input
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png"
                                    onChange={handleUpload}
                                    disabled={isUploading}
                                    className="hidden"
                                />
                                {isUploading ? (
                                    <div className="w-full flex flex-col items-center max-w-xs space-y-4">
                                        <div className="relative flex items-center justify-center">
                                            <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                                            <span className="absolute text-[10px] font-bold text-blue-600 mt-[1px]">
                                                {Math.round(uploadingFileName ? (uploadState[uploadingFileName]?.progress ?? 0) : 0)}%
                                            </span>
                                        </div>
                                        <div className="w-full space-y-1.5 text-center">
                                            <p className="text-slate-700 font-semibold text-sm truncate max-w-[240px] mx-auto">
                                                Uploading {uploadingFileName}
                                            </p>
                                            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-blue-600 transition-all duration-300"
                                                    style={{ width: `${uploadingFileName ? (uploadState[uploadingFileName]?.progress ?? 0) : 0}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <Plus className="w-12 h-12 text-slate-400 mb-4" />
                                        <p className="text-slate-900 font-semibold mb-2">Click to upload</p>
                                        <p className="text-sm text-slate-500">PDF, JPG, or PNG (max 5MB)</p>
                                    </>
                                )}
                            </label>
                        </div>

                        {/* Uploaded List */}
                        <div className="bg-white rounded-2xl p-6 shadow-xl">
                            <h2 className="text-xl font-bold text-slate-900 mb-6">
                                Your Uploaded Documents ({certificates.length})
                            </h2>
                            {certificates.length === 0 ? (
                                <div className="text-center py-12">
                                    <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                                    <p className="text-slate-600">
                                        No documents yet. Upload your first certificate above.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {certificates.map((cert) => (
                                        <div
                                            key={cert.id}
                                            className="flex items-center justify-between p-4 border border-slate-200 rounded-xl hover:border-blue-500 transition"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                                                    <FileText className="w-6 h-6 text-blue-600" />
                                                </div>
                                                <div>
                                                    <h3 className="font-semibold text-slate-900">{cert.fileName}</h3>
                                                    <p className="text-sm text-slate-500">
                                                        Uploaded {new Date(cert.uploadedAt).toLocaleDateString()}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleDownload(cert)}
                                                    className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition"
                                                    title="Download"
                                                >
                                                    <Download className="w-5 h-5" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(cert.id)}
                                                    className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
