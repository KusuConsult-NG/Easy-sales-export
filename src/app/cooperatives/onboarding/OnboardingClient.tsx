/**
 * Cooperative Membership Onboarding
 *
 * 4-step flow: Personal Info → Next of Kin → Documents → Payment & Submit
 */

"use client";

import { useState, useEffect } from "react";
import { logger } from '@/lib/logger';
import { ArrowLeft, CreditCard, CheckCircle, ShieldCheck, Loader2, Home } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerCooperativeMemberAction, initiateCooperativePaymentAction, checkCooperativeStatusAction, getCooperativeApplicationAction, resubmitCooperativeApplicationAction } from "@/app/actions/cooperative";
import { CooperativeErrorBoundary } from "@/components/errors/CooperativeErrorBoundary";
import { useToast } from "@/contexts/ToastContext";
import { useSession } from "next-auth/react";
import { AlertTriangle } from "lucide-react";

import { COOPERATIVE_CONFIG, CURRENCY_CONFIG } from "@/lib/constants";
// Steps
import PersonalInfoStep from "./steps/PersonalInfoStep";
import NextOfKinStep from "./steps/NextOfKinStep";
import DocumentUploadStep from "./steps/DocumentUploadStep";

interface OnboardingContentProps {
    initialTier: "Member";
    paymentStatus: string; // "pending" | "completed"
    inviteToken?: string;
}

function CooperativeOnboardingContent({ initialTier, paymentStatus }: OnboardingContentProps) {
    const router = useRouter();
    const { showToast } = useToast();
    const { data: session, status, update: updateSession } = useSession();

    // If payment is already done, start at step 4 (review & submit)
    const [currentStep, setCurrentStep] = useState(paymentStatus === "completed" ? 4 : 1);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isPaymentLoading, setIsPaymentLoading] = useState(false);
    const [isCheckingStatus, setIsCheckingStatus] = useState(true);
    const [revisionNote, setRevisionNote] = useState<string | null>(null);
    const [isRevisionMode, setIsRevisionMode] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    // True for members onboarded before the platform — payment already confirmed by admin.
    const [isLegacyImport, setIsLegacyImport] = useState(false);
    const [validInviteToken, setValidInviteToken] = useState<string | null>(null);
    const [version, setVersion] = useState<number | undefined>(undefined);
    const [isInitialized, setIsInitialized] = useState(false);

    const [tier] = useState<"Member">("Member");

    const [personalInfo, setPersonalInfo] = useState({
        firstName: "",
        lastName: "",
        otherName: "",
        phone: "",
        email: "",
        dateOfBirth: "",
        gender: "",
        occupation: "",
        address: {
            state: "",
            lga: "",
            ward: "",
            street: ""
        }
    });

    const [nextOfKin, setNextOfKin] = useState({
        fullName: "",
        relationship: "",
        phone: "",
        address: ""
    });

    const [documents, setDocuments] = useState({
        validId: undefined as { name: string; url: string } | undefined,
        passportPhoto: undefined as { name: string; url: string } | undefined,
        proofOfAddress: undefined as { name: string; url: string } | undefined,
        bvn: "",
        nin: ""
    });

    // ── Status check on mount — replaces server-side Firestore read ────────────
    useEffect(() => {
        // SESSION CRASH FIX: do not run until NextAuth has finished loading.
        // Without this guard, requireSession() inside the action may fail because
        // the session cookie hasn't been read yet, causing the component to render
        // in an inconsistent half-loaded state that looks like a crash.
        if (status === "loading") return;

        // Detect dedicated domain (easysalescooperative.com).
        // On dedicated domains, proxy maps / → /cooperatives, so '/cooperatives/dashboard'
        // causes double-rewrite → /cooperatives/cooperatives/dashboard → 404.
        // Use short paths when on dedicated domain.
        let appHostname = 'easysalesexport.com';
        if (process.env.NEXT_PUBLIC_APP_URL) {
            try {
                appHostname = new URL(process.env.NEXT_PUBLIC_APP_URL).hostname;
            } catch {
                appHostname = process.env.NEXT_PUBLIC_APP_URL.replace(/https?:\/\//, '').split('/')[0].split(':')[0];
            }
        }
        const isDedicatedDomain = typeof window !== 'undefined' &&
            !window.location.hostname.includes(appHostname) &&
            !window.location.hostname.includes('localhost') &&
            !window.location.hostname.includes('127.0.0.1') &&
            !window.location.hostname.includes('railway.app');
        const prefix = isDedicatedDomain ? '' : '/cooperatives';

        // Check if there's an invite token passed as a prop (from searchParams)
        if (typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token');
            if (token) {
                 import("@/app/actions/cooperative").then(({ validateCooperativeInviteAction }) => {
                     validateCooperativeInviteAction(token).then((validateRes) => {
                          if (validateRes.success) {
                               setIsLegacyImport(true);
                               setValidInviteToken(token);
                               setIsCheckingStatus(false);
                          } else {
                               showToast(validateRes.error || "Invalid invite link", "error");
                               checkStatusFromBackend();
                          }
                     });
                 });
                 return; // Pause execution here until token is validated
            }
        }
        
        checkStatusFromBackend();

        function checkStatusFromBackend() {
            checkCooperativeStatusAction().then(async (coopStatus) => {
            if (coopStatus === "active" || coopStatus === "approved") {
                setIsCheckingStatus(false);
                router.replace(`${prefix}/dashboard`);
                return;
            }
            // Legacy import: member is approved + paid offline, just needs to fill the form.
            // Do NOT redirect — stay on this page and show form with payment step bypassed.
            if (coopStatus === "legacy_pending_onboarding") {
                setIsLegacyImport(true);
                setIsCheckingStatus(false);
                return;
            }
            if (coopStatus === "pending" || coopStatus === "under_review" || coopStatus === "pending_repair") {
                const params = new URLSearchParams(window.location.search);
                const isEditParam = params.get("edit") === "true" || coopStatus === "pending_repair";

                if (isEditParam) {
                    const result = await getCooperativeApplicationAction();
                    if (result.success && result.data?.application) {
                        const d = result.data.application;
                        if (d.firstName || d.fullName) {
                            setPersonalInfo((prev: any) => ({
                                ...prev,
                                firstName: d.firstName || (d.fullName ? d.fullName.split(' ')[0] : '') || prev.firstName,
                                lastName: d.lastName || (d.fullName ? d.fullName.split(' ').slice(1).join(' ') : '') || prev.lastName,
                                fullName: d.fullName || `${d.firstName || ''} ${d.lastName || ''}`.trim(),
                                phone: d.phone || prev.phone,
                                email: d.email || prev.email,
                                dateOfBirth: d.dateOfBirth || prev.dateOfBirth,
                                gender: d.gender || prev.gender,
                                occupation: d.occupation || prev.occupation,
                                address: {
                                    state: d.stateOfOrigin || prev.address?.state || "",
                                    lga: d.lga || prev.address?.lga || "",
                                    ward: d.ward || prev.address?.ward || "",
                                    street: d.residentialAddress || prev.address?.street || ""
                                }
                            }));
                        }
                        if (d.nextOfKinName) {
                            setNextOfKin((prev: any) => ({
                                ...prev,
                                fullName: d.nextOfKinName || prev.fullName,
                                phone: d.nextOfKinPhone || prev.phone,
                                address: d.nextOfKinAddress || prev.address,
                            }));
                        }
                        if (d._version !== undefined) {
                            setVersion(d._version);
                        }
                        if (d.documents || d.bvn || d.nin) {
                            setDocuments((prev: any) => ({
                                ...prev,
                                validId: d.documents?.validId || prev.validId,
                                passportPhoto: d.documents?.passportPhoto || prev.passportPhoto,
                                proofOfAddress: d.documents?.proofOfAddress || prev.proofOfAddress,
                                bvn: d.bvn || prev.bvn,
                                nin: d.nin || prev.nin
                            }));
                        }
                    }
                    setIsEditMode(true);
                    setIsCheckingStatus(false);
                    return;
                } else {
                    // Stay on page — do NOT auto-redirect pending users without onboardingCompleted
                    setIsCheckingStatus(false);
                    return;
                }
            }
            if (coopStatus === "payment_required") {
                const result = await getCooperativeApplicationAction();
                if (result.success && result.data?.application) {
                    const d = result.data.application;
                    if (d.firstName || d.fullName) {
                        setPersonalInfo((prev: any) => ({
                            ...prev,
                            firstName: d.firstName || (d.fullName ? d.fullName.split(' ')[0] : '') || prev.firstName,
                            lastName: d.lastName || (d.fullName ? d.fullName.split(' ').slice(1).join(' ') : '') || prev.lastName,
                            fullName: d.fullName || `${d.firstName || ''} ${d.lastName || ''}`.trim(),
                            phone: d.phone || prev.phone,
                            email: d.email || prev.email,
                            dateOfBirth: d.dateOfBirth || prev.dateOfBirth,
                            gender: d.gender || prev.gender,
                            occupation: d.occupation || prev.occupation,
                            address: {
                                state: d.stateOfOrigin || prev.address?.state || "",
                                lga: d.lga || prev.address?.lga || "",
                                ward: d.ward || prev.address?.ward || "",
                                street: d.residentialAddress || prev.address?.street || ""
                            }
                        }));
                    }
                    if (d.nextOfKinName) {
                        setNextOfKin((prev: any) => ({
                            ...prev,
                            fullName: d.nextOfKinName || prev.fullName,
                            phone: d.nextOfKinPhone || prev.phone,
                            address: d.nextOfKinAddress || prev.address,
                        }));
                    }
                    if (d._version !== undefined) {
                        setVersion(d._version);
                    }
                    if (d.documents || d.bvn || d.nin) {
                        setDocuments((prev: any) => ({
                            ...prev,
                            validId: d.documents?.validId || prev.validId,
                            passportPhoto: d.documents?.passportPhoto || prev.passportPhoto,
                            proofOfAddress: d.documents?.proofOfAddress || prev.proofOfAddress,
                            bvn: d.bvn || prev.bvn,
                            nin: d.nin || prev.nin
                        }));
                    }
                }
                setCurrentStep(4);
                setIsCheckingStatus(false);
                return;
            }
            // LOOP FIX: "pending_review" means form was already submitted and is awaiting
            // admin approval. Redirect to the waiting page immediately — do NOT show the
            // blank form again, which caused users to get stuck in an infinite submit loop.
            if (coopStatus === "pending_review") {
                setIsCheckingStatus(false);
                router.replace(`${prefix}/onboarding/pending`);
                return;
            }
            if (coopStatus === "revision_required" || coopStatus === "rejected") {
                // Pre-populate form with existing data
                const result = await getCooperativeApplicationAction();
                if (result.success && result.data?.application) {
                    const d = result.data.application;
                    if (d.firstName || d.fullName) {
                        setPersonalInfo((prev: any) => ({
                            ...prev,
                            firstName: d.firstName || (d.fullName ? d.fullName.split(' ')[0] : '') || prev.firstName,
                            lastName: d.lastName || (d.fullName ? d.fullName.split(' ').slice(1).join(' ') : '') || prev.lastName,
                            phone: d.phone || prev.phone,
                            email: d.email || prev.email,
                            dateOfBirth: d.dateOfBirth || prev.dateOfBirth,
                            gender: d.gender || prev.gender,
                            occupation: d.occupation || prev.occupation,
                            address: {
                                state: d.stateOfOrigin || prev.address?.state || "",
                                lga: d.lga || prev.address?.lga || "",
                                ward: d.ward || prev.address?.ward || "",
                                street: d.residentialAddress || prev.address?.street || ""
                            }
                        }));
                    }
                    if (d.nextOfKinName) {
                        setNextOfKin((prev: any) => ({
                            ...prev,
                            fullName: d.nextOfKinName || prev.fullName,
                            phone: d.nextOfKinPhone || prev.phone,
                            address: d.nextOfKinAddress || prev.address,
                        }));
                    }
                    if (d._version !== undefined) {
                        setVersion(d._version);
                    }
                    if (d.documents || d.bvn || d.nin) {
                        setDocuments((prev: any) => ({
                            ...prev,
                            validId: d.documents?.validId || prev.validId,
                            passportPhoto: d.documents?.passportPhoto || prev.passportPhoto,
                            proofOfAddress: d.documents?.proofOfAddress || prev.proofOfAddress,
                            bvn: d.bvn || prev.bvn,
                            nin: d.nin || prev.nin
                        }));
                    }
                }
                if (result.data?.revisionNote) setRevisionNote(result.data.revisionNote);
                setIsRevisionMode(true);
                setIsCheckingStatus(false);
                return;
            }
            // null = no application yet — show the form
            setIsCheckingStatus(false);
        }).catch(() => {
            setIsCheckingStatus(false);
        });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]); // re-run once session transitions from "loading" → "authenticated"

    // ── User-scoped localStorage keys ────────────────────────────────────────
    // Keys are namespaced by userId so two users on the same device never share
    // sensitive personal / next-of-kin / document data.
    const userId = session?.user?.id;
    const keyOf = (suffix: string) => userId ? `coop_onboarding_${userId}_${suffix}` : null;

    // --- Persist state across Paystack redirect ---
    useEffect(() => {
        if (status === "loading" || !userId || isInitialized) return;
        
        const savedPersonalInfo = localStorage.getItem(keyOf('personal') as string);
        if (savedPersonalInfo) {
            try {
                const parsed = JSON.parse(savedPersonalInfo);
                if (parsed && typeof parsed === 'object') {
                    setPersonalInfo(prev => ({
                        ...prev,
                        ...parsed,
                        address: {
                            state: parsed.address?.state || prev.address?.state || "",
                            lga: parsed.address?.lga || prev.address?.lga || "",
                            ward: parsed.address?.ward || prev.address?.ward || "",
                            street: parsed.address?.street || prev.address?.street || ""
                        }
                    }));
                }
            } catch (e) {
                console.error("Failed to parse saved personal info", e);
            }
        }

        const savedNextOfKin = localStorage.getItem(keyOf('nok') as string);
        if (savedNextOfKin) {
            try {
                setNextOfKin(JSON.parse(savedNextOfKin));
            } catch (e) {
                console.error("Failed to parse saved next of kin", e);
            }
        }

        const savedDocuments = localStorage.getItem(keyOf('docs') as string);
        if (savedDocuments) {
            try {
                setDocuments(JSON.parse(savedDocuments));
            } catch (e) {
                console.error("Failed to parse saved documents", e);
            }
        }
        
        setIsInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, status, isInitialized]);

    useEffect(() => {
        if (!isInitialized || !userId) return;
        const k = keyOf('personal');
        if (k) localStorage.setItem(k, JSON.stringify(personalInfo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personalInfo, userId, isInitialized]);

    useEffect(() => {
        if (!isInitialized || !userId) return;
        const k = keyOf('nok');
        if (k) localStorage.setItem(k, JSON.stringify(nextOfKin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nextOfKin, userId, isInitialized]);

    useEffect(() => {
        if (!isInitialized || !userId) return;
        const k = keyOf('docs');
        if (k) localStorage.setItem(k, JSON.stringify(documents));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documents, userId, isInitialized]);
    // ─────────────────────────────────────────────────────────────────────────

    // isPaid: true if Paystack payment already confirmed OR if this is a legacy import
    // (payment was verified offline by admin — the script sets paymentStatus='completed').
    const isPaid = paymentStatus === "completed" || isLegacyImport;
    const totalSteps = 4;

    const steps = [
        { number: 1, name: "Personal Info" },
        { number: 2, name: "Next of Kin" },
        { number: 3, name: "Documents" },
        { number: 4, name: isLegacyImport ? "Review & Submit" : "Payment" },
    ];
    async function saveApplicationData() {
        const missingPersonal =
            !personalInfo.firstName.trim() || personalInfo.firstName.trim().length < 2 ||
            !personalInfo.lastName.trim() || personalInfo.lastName.trim().length < 2 ||
            !personalInfo.phone.trim() ||
            !personalInfo.email.trim() ||
            !personalInfo.gender ||
            !personalInfo.occupation.trim() ||
            !personalInfo.address.state ||
            !personalInfo.address.ward ||
            !personalInfo.address.street.trim();

        const missingNok =
            !nextOfKin.fullName.trim() || nextOfKin.fullName.trim().length < 2 ||
            !nextOfKin.phone.trim() ||
            !nextOfKin.address.trim();

        const missingDocs =
            !documents.validId?.url ||
            !documents.passportPhoto?.url ||
            !documents.bvn || !/^\d{11}$/.test(documents.bvn) ||
            !documents.nin || !/^\d{11}$/.test(documents.nin);

        if (missingPersonal) {
            showToast("Please complete your personal information before proceeding.", "error");
            setCurrentStep(1);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return { success: false, error: null };
        }
        if (missingNok) {
            showToast("Please complete the Next of Kin information before proceeding.", "error");
            setCurrentStep(2);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return { success: false, error: null };
        }
        if (missingDocs) {
            showToast("Please complete your document uploads and verify your BVN/NIN before proceeding.", "error");
            setCurrentStep(3);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return { success: false, error: null };
        }

        const formData = new FormData();
        formData.append("membershipTier", tier);
        if (validInviteToken) {
             formData.append("inviteToken", validInviteToken);
        }
        formData.append("firstName", personalInfo.firstName.trim());
        formData.append("lastName", personalInfo.lastName.trim());
        if (personalInfo.otherName?.trim()) formData.append("otherName", personalInfo.otherName.trim());
        formData.append("fullName", [personalInfo.firstName, personalInfo.otherName, personalInfo.lastName]
            .filter(Boolean).map(s => s?.trim()).join(" ").trim());
        formData.append("dateOfBirth", personalInfo.dateOfBirth);
        formData.append("gender", personalInfo.gender);
        formData.append("email", personalInfo.email);
        formData.append("phone", personalInfo.phone);
        formData.append("occupation", personalInfo.occupation);
        formData.append("stateOfOrigin", personalInfo.address.state);
        formData.append("lga", personalInfo.address.lga || "N/A");
        formData.append("ward", personalInfo.address.ward || "");
        formData.append("residentialAddress", personalInfo.address.street);
        formData.append("nextOfKinName", nextOfKin.fullName);
        formData.append("nextOfKinPhone", nextOfKin.phone);
        formData.append("nextOfKinAddress", nextOfKin.address);

        if (documents.validId?.url) {
            formData.append("validIdUrl", documents.validId.url);
            formData.append("validIdName", documents.validId.name);
        }
        if (documents.passportPhoto?.url) {
            formData.append("passportPhotoUrl", documents.passportPhoto.url);
            formData.append("passportPhotoName", documents.passportPhoto.name);
        }
        if (documents.proofOfAddress?.url) {
            formData.append("proofOfAddressUrl", documents.proofOfAddress.url);
            formData.append("proofOfAddressName", documents.proofOfAddress.name);
        }
        if (documents.bvn) {
            formData.append("bvn", documents.bvn);
        }
        if (documents.nin) {
            formData.append("nin", documents.nin);
        }
        if (version !== undefined) {
            formData.append("_version", version.toString());
        }

        const result = (isRevisionMode || isEditMode)
            ? await resubmitCooperativeApplicationAction(formData)
            : await registerCooperativeMemberAction(formData);

        return result;
    }

    async function handlePayNow() {
        setIsPaymentLoading(true);
        try {
            // Save form details first
            const saveResult = await saveApplicationData();
            if (!saveResult.success) {
                setIsPaymentLoading(false);
                if (saveResult.error) {
                    showToast(saveResult.error, "error");
                }
                return;
            }

            // Initiate payment
            const result = await initiateCooperativePaymentAction("Member");
            if (result.success && result.data?.redirectTo) {
                // Already paid — since we saved form data first, they are now fully pending review
                showToast("Payment confirmed and application submitted!", "success");
                if (userId) {
                    ['personal', 'nok', 'docs'].forEach(s => {
                        try { localStorage.removeItem(`coop_onboarding_${userId}_${s}`); } catch { /* non-blocking */ }
                    });
                }
                try {
                    await updateSession();
                } catch (updateErr) {
                    logger.error("Session update failed in handlePayNow:", updateErr);
                }
                const isDed = typeof window !== 'undefined' &&
                    !window.location.hostname.includes('easysalesexport.com') &&
                    !window.location.hostname.includes('localhost') &&
                    !window.location.hostname.includes('railway.app');
                if (isLegacyImport) {
                    router.replace(isDed ? '/dashboard' : '/cooperatives/dashboard');
                } else {
                    router.replace(isDed ? '/onboarding/pending' : '/cooperatives/onboarding/pending');
                }
                return;
            }
            if (result.success && result.data?.paymentUrl) {
                window.location.href = result.data.paymentUrl;
            } else {
                showToast(result.error || "Failed to initiate payment", "error");
                setIsPaymentLoading(false);
            }
        } catch (error) {
            showToast("An unexpected error occurred", "error");
            setIsPaymentLoading(false);
        }
    }

    async function handleComplete() {
        setIsSubmitting(true);
        try {
            const result = await saveApplicationData();
            if (result.success) {
                if (userId) {
                    ['personal', 'nok', 'docs'].forEach(s => {
                        try { localStorage.removeItem(`coop_onboarding_${userId}_${s}`); } catch { /* non-blocking */ }
                    });
                }
                showToast(
                    (isRevisionMode || isEditMode) ? "Application resubmitted for review!" : "Application submitted successfully!",
                    "success"
                );
                try {
                    await updateSession();
                } catch (updateErr) {
                    logger.error("Session update failed in handleComplete:", updateErr);
                }
                setIsSubmitting(false);
                const isDed = typeof window !== 'undefined' &&
                    !window.location.hostname.includes('easysalesexport.com') &&
                    !window.location.hostname.includes('localhost') &&
                    !window.location.hostname.includes('railway.app');
                if (isLegacyImport) {
                    router.replace(isDed ? '/dashboard' : '/cooperatives/dashboard');
                } else {
                    router.replace(isDed ? '/onboarding/pending' : '/cooperatives/onboarding/pending');
                }
            } else {
                if (result.error) {
                    showToast(result.error, "error");
                }
                setIsSubmitting(false);
            }
        } catch (error) {
            logger.error("Registration error:", error);
            showToast("An unexpected error occurred.", "error");
            setIsSubmitting(false);
        }
    }
    // Show spinner while checking status to avoid flash of incorrect step
    if (isCheckingStatus) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-4xl mx-auto px-8 py-6">
                    <div className="flex items-center justify-between mb-4">
                        <Link
                            href="/cooperatives"
                            className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Cooperatives
                        </Link>
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center gap-2 text-slate-600 hover:text-purple-600 text-sm font-medium"
                        >
                            <Home className="w-4 h-4" />
                            Hub
                        </Link>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900">
                        Cooperative Membership Application
                    </h1>
                    <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-600">
                        <span>Powered by</span>
                        <span className="font-bold text-purple-600">Easy Sales Export</span>
                    </div>
                </div>
            </div>

            {/* Revision Banner */}
            {isRevisionMode && revisionNote && (
                <div className="max-w-4xl mx-auto px-8 pt-6">
                    <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex gap-3 items-start">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-amber-800">Revision Requested by Admin</p>
                            <p className="text-sm text-amber-700 mt-1">{revisionNote}</p>
                            <p className="text-xs text-amber-600 mt-2">Please update your details below and resubmit.</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Banner for purely 'pending' edits */}
            {isEditMode && !isRevisionMode && (
                <div className="max-w-4xl mx-auto px-8 pt-6">
                    <div className="p-4 bg-blue-50 border border-blue-300 rounded-xl flex gap-3 items-start">
                        <AlertTriangle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-blue-900">Editing Application</p>
                            <p className="text-sm text-blue-700 mt-1">You are modifying a submitted application. Your changes will be saved when you complete the form.</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Progress Indicator */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-4xl mx-auto px-8 py-6">
                    <div className="flex items-center justify-between mb-4">
                        {steps.map((step, index) => (
                            <div key={step.number} className="flex items-center flex-1">
                                <div className="flex flex-col items-center flex-1">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all ${currentStep > step.number
                                        ? "bg-purple-600 text-white"
                                        : currentStep === step.number
                                            ? "bg-purple-600 text-white ring-4 ring-purple-200"
                                            : "bg-slate-200 text-slate-600"
                                        }`}>
                                        {currentStep > step.number ? <CheckCircle className="w-5 h-5" /> : step.number}
                                    </div>
                                    <span className={`text-xs mt-2 font-medium ${currentStep === step.number ? "text-purple-600" : "text-slate-600"
                                        }`}>
                                        {step.name}
                                    </span>
                                </div>
                                {index < steps.length - 1 && (
                                    <div className={`h-0.5 flex-1 mx-2 ${currentStep > step.number ? "bg-purple-600" : "bg-slate-200"
                                        }`} />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="text-center">
                        <p className="text-sm text-slate-600">
                            Step {currentStep} of {totalSteps}
                        </p>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto px-8 py-12">
                {currentStep === 1 && (
                    <PersonalInfoStep
                        data={personalInfo}
                        onChange={(data) => setPersonalInfo({ ...data, otherName: data.otherName ?? "" })}
                        onNext={() => setCurrentStep(2)}
                        onBack={() => {
                            // Use short path on dedicated domain to avoid double-rewrite
                            const isDed = typeof window !== 'undefined' &&
                                !window.location.hostname.includes('easysalesexport.com') &&
                                !window.location.hostname.includes('localhost') &&
                                !window.location.hostname.includes('railway.app');
                            router.push(isDed ? '/' : '/cooperatives');
                        }}
                    />
                )}
                {currentStep === 2 && (
                    <NextOfKinStep
                        data={nextOfKin}
                        onChange={setNextOfKin}
                        onNext={() => setCurrentStep(3)}
                        onBack={() => setCurrentStep(1)}
                    />
                )}
                {currentStep === 3 && (
                    <DocumentUploadStep
                        data={documents}
                        onChange={setDocuments}
                        onNext={() => setCurrentStep(4)}
                        onBack={() => setCurrentStep(2)}
                    />
                )}

                {/* Step 4: Payment & Submit */}
                {currentStep === 4 && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-8">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-1">
                                {isLegacyImport ? "Review & Submit" : "Membership Payment"}
                            </h2>
                            <p className="text-slate-500">
                                {isLegacyImport
                                    ? "Your registration fee has already been received. Please review and submit your details."
                                    : "Complete your one-time membership fee to submit your application."}
                            </p>
                        </div>

                        {isPaid ? (
                            /* Payment already done — show submit */
                            <div className="space-y-6">
                                <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                                    <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
                                    <div>
                                        {isLegacyImport ? (
                                            <>
                                                <p className="font-semibold text-green-800">Payment Verified by Admin</p>
                                                <p className="text-sm text-green-700">Your registration fee has been confirmed from records. Submit your details to activate your membership.</p>
                                            </>
                                        ) : (
                                            <>
                                                <p className="font-semibold text-green-800">Payment Confirmed</p>
                                                <p className="text-sm text-green-700">Your {CURRENCY_CONFIG.symbol}{COOPERATIVE_CONFIG.registrationFee.toLocaleString()} membership fee has been received.</p>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <p className="text-slate-600">
                                    Your application is ready to submit. Click below to send it for admin review.
                                </p>

                                <div className="flex gap-4">
                                    <button
                                        onClick={() => setCurrentStep(3)}
                                        className="px-6 py-3 border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition"
                                    >
                                        ← Back
                                    </button>
                                    <button
                                        onClick={handleComplete}
                                        disabled={isSubmitting}
                                        className="flex-1 flex items-center justify-center gap-2 py-3 px-6 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold transition disabled:opacity-70 disabled:cursor-not-allowed"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                Submitting Application...
                                            </>
                                        ) : (
                                            "Submit Application →"
                                        )}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* Payment not yet done — show pay button */
                            <div className="space-y-6">
                                <div className="text-center py-6 border-2 border-dashed border-purple-200 rounded-2xl bg-purple-50">
                                    <p className="text-sm font-semibold text-purple-600 uppercase tracking-widest mb-2">One-Time Membership Fee</p>
                                    <div className="text-5xl font-extrabold text-slate-900 mb-1">{CURRENCY_CONFIG.symbol}{COOPERATIVE_CONFIG.registrationFee.toLocaleString()}</div>
                                    <p className="text-slate-500 text-sm">Pay once. Access forever.</p>
                                </div>

                                <ul className="space-y-2 text-sm text-slate-600">
                                    {[
                                        "Access to low-interest business loans",
                                        "High-yield fixed savings plans",
                                        "Network with top agricultural exporters",
                                        "Exclusive export market insights",
                                    ].map((item, i) => (
                                        <li key={i} className="flex items-center gap-2">
                                            <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                                            {item}
                                        </li>
                                    ))}
                                </ul>

                                <div className="flex gap-4">
                                    <button
                                        onClick={() => setCurrentStep(3)}
                                        className="px-6 py-3 border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition"
                                    >
                                        ← Back
                                    </button>
                                    <button
                                        onClick={handlePayNow}
                                        disabled={isPaymentLoading}
                                        className="flex-1 flex items-center justify-center gap-2 py-3 px-6 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold transition disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-purple-200"
                                    >
                                        {isPaymentLoading ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                Redirecting to payment...
                                            </>
                                        ) : (
                                            <>
                                                <CreditCard className="w-5 h-5" />
                                                Pay {CURRENCY_CONFIG.symbol}{COOPERATIVE_CONFIG.registrationFee.toLocaleString()} Now
                                            </>
                                        )}
                                    </button>
                                </div>

                                <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                                    <ShieldCheck className="w-4 h-4" />
                                    <span>Secured by Paystack</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function CooperativeOnboardingClient({ initialTier, paymentStatus, inviteToken }: OnboardingContentProps) {
    return (
        <CooperativeErrorBoundary>
            <CooperativeOnboardingContent initialTier={initialTier} paymentStatus={paymentStatus} inviteToken={inviteToken} />
        </CooperativeErrorBoundary>
    );
}
