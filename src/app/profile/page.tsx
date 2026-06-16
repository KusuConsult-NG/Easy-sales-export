"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import {
    User, Mail, Phone, MapPin, Shield, Bell,
    LogOut, Camera, Save, Lock, CheckCircle, Upload, FileText
} from "lucide-react";
import Image from "next/image";

import { getUserProfileAction, updateUserProfileAction, updateNotificationPreferencesAction } from "@/app/actions/profile";
import { changePasswordAction } from "@/app/actions/auth";
import { signOut } from "next-auth/react";
import { useSessionExpiry } from "@/hooks/useSessionExpiry";
import { useRouter, useSearchParams } from "next/navigation";

export default function ProfilePage() {
    const { data: session, update } = useSession();

    const { run: guardRun } = useSessionExpiry();
    const router = useRouter();
    const searchParams = useSearchParams();
    const notice = searchParams.get('notice');
    
    const [activeTab, setActiveTab] = useState<'general' | 'security' | 'preferences'>('general');
    const [isLoading, setIsLoading] = useState(false);
    const [isFetching, setIsFetching] = useState(true);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Real user data from Firestore
    const [userData, setUserData] = useState({
        firstName: "",
        lastName: "",
        otherName: "",
        email: "",
        phone: "",
        location: "",
        bio: "",
        identityDocument: "",
        photoURL: "",
        gender: "" as "male" | "female" | "",
        notifications: {
            email: true,
            push: false,
            sms: true
        }
    });

    const [countryCode, setCountryCode] = useState("+234");
    const [rawPhone, setRawPhone] = useState("");
    const [isUploadingDoc, setIsUploadingDoc] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploadingImage, setIsUploadingImage] = useState(false);

    // Password change state
    const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [passwordData, setPasswordData] = useState({ current: "", new: "", confirm: "" });
    const [passwordError, setPasswordError] = useState("");
    const [passwordSuccess, setPasswordSuccess] = useState("");

    const handleAvatarClick = () => {
        fileInputRef.current?.click();
    };

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploadingImage(true);
        setSaveMessage(null);
        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("folder", "avatars");

            const res = await fetch("/api/upload", { method: "POST", body: formData });
            const data = await res.json();

            if (data.success && data.url) {
                // Update Firestore profile with the photoURL
                const result = await guardRun(updateUserProfileAction({
                    photoURL: data.url
                }));

                if (result.success) {
                    setUserData(prev => ({ ...prev, photoURL: data.url }));
                    
                    // Sync the NextAuth session image on the client
                    await update({ image: data.url });

                    setSaveMessage({ type: 'success', text: 'Profile picture updated successfully!' });
                } else {
                    setSaveMessage({ type: 'error', text: result.error || 'Failed to save profile picture URL' });
                }
            } else {
                setSaveMessage({ type: 'error', text: data.error || 'Failed to upload image' });
            }
        } catch (err) {
            console.error("Avatar upload error:", err);
            setSaveMessage({ type: 'error', text: 'An error occurred during avatar upload' });
        } finally {
            setIsUploadingImage(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
            setTimeout(() => setSaveMessage(null), 4000);
        }
    };

    // Load user profile on mount
    useEffect(() => {
        async function loadProfile() {
            setIsFetching(true);
            const result = await getUserProfileAction();

            if (result.success && result.data?.profile) {
                const p = result.data.profile;
                const splitName = (n: string) => { const parts = (n || "").trim().split(/\s+/).filter(Boolean); return { first: parts[0] || "", last: parts.slice(1).join(" ") }; };
                const nameFallback = splitName(session?.user?.name || "");
                setUserData({
                    firstName: p.firstName || nameFallback.first,
                    lastName: p.lastName || nameFallback.last,
                    otherName: p.otherName || "",
                    email: p.email || session?.user?.email || "",
                    phone: p.phone || "",
                    location: p.location || "",
                    bio: p.bio || "",
                    identityDocument: p.identityDocument || "",
                    photoURL: p.photoURL || "",
                    gender: p.gender || (session?.user as any)?.gender || "",
                    notifications: p.notifications || { email: true, push: false, sms: true },
                });

                // Parse phone — use a known country-code list to avoid greedy over-matching.
                // e.g. +2348036546039 should parse as code=+234, not code=+2348.
                const savedPhone = p.phone || "";
                if (savedPhone.startsWith('+')) {
                    // Known multi-digit country codes to check (longest first to avoid false matches)
                    const KNOWN_CODES = ["+234", "+1", "+44", "+27", "+233", "+254", "+256", "+255", "+260", "+263"];
                    const matched = KNOWN_CODES.find(c => savedPhone.startsWith(c));
                    if (matched) {
                        setCountryCode(matched);
                        setRawPhone(savedPhone.slice(matched.length));
                    } else {
                        // Fallback: take the first 1–4 digits
                        const fallback = savedPhone.match(/^(\+\d{1,4})/);
                        if (fallback) {
                            setCountryCode(fallback[1]);
                            setRawPhone(savedPhone.slice(fallback[1].length));
                        }
                    }
                } else if (savedPhone.startsWith('0')) {
                    setCountryCode('+234');
                    setRawPhone(savedPhone.slice(1));
                } else {
                    setRawPhone(savedPhone);
                }
            } else if (session?.user) {
                const splitName = (n: string) => { const parts = (n || "").trim().split(/\s+/).filter(Boolean); return { first: parts[0] || "", last: parts.slice(1).join(" ") }; };
                const { first, last } = splitName(session.user.name || "");
                setUserData(prev => ({
                    ...prev,
                    firstName: first,
                    lastName: last,
                    otherName: "",
                    email: session?.user?.email || "",
                    gender: (session?.user as any)?.gender || "",
                }));
            }
            setIsFetching(false);
        }

        if (session?.user) {
            loadProfile();
        }
    }, [session]);

    async function handleSave() {
        setIsLoading(true);
        setSaveMessage(null);

        // Determine what to save based on active tab
        if (activeTab === 'general') {
            const isWaveParticipant = session?.user?.roles?.includes('wave_participant');
            // Nigerian users: country code is +234 OR starts with +234 (e.g. +2348...)
            const isNigerian = countryCode === '+234' || countryCode.startsWith('+234');
            const isNonNigerian = !isWaveParticipant && !isNigerian;
            
            if (isNonNigerian && !userData.identityDocument) {
                setSaveMessage({ type: 'error', text: "Government Issued ID is required for non-Nigerians." });
                setIsLoading(false);
                return;
            }

            const sessionEmail = session?.user?.email || "";
            const emailChanged = sessionEmail !== "" && userData.email !== "" && userData.email !== sessionEmail;
            if (!rawPhone || rawPhone.trim() === "") {
                setSaveMessage({ type: 'error', text: "Phone number is required." });
                setIsLoading(false);
                return;
            }
            
            // Format phone number
            const fullPhone = `${countryCode}${rawPhone.startsWith('0') && countryCode === '+234' ? rawPhone.slice(1) : rawPhone}`.trim();

            const result = await guardRun(updateUserProfileAction({
                firstName: userData.firstName,
                lastName: userData.lastName,
                otherName: userData.otherName,
                email: userData.email,
                phone: fullPhone,
                location: userData.location,
                bio: userData.bio,
                identityDocument: userData.identityDocument,
            }));

            if (result.success) {
                if (emailChanged) {
                    // Session JWT is now stale — user must re-login with the new email
                    setSaveMessage({ type: 'success', text: 'Email updated! You will be signed out to apply the change.' });
                    setTimeout(() => signOut({ callbackUrl: "/auth/login" }), 2500);
                } else {
                    setSaveMessage({ type: 'success', text: 'Profile updated successfully!' });

                    // Always clear the ?notice= param from the URL so the browser history
                    // doesn't re-trigger the hub-guard redirect on back navigation.
                    if (notice) {
                        window.history.replaceState({}, '', '/profile');
                    }

                    // Rebuild session JWT with the updated user data in cache/Redis
                    update().catch((updateErr) => {
                        console.error("Session update failed:", updateErr);
                    });

                    // Clear client-side route cache to ensure server components read the updated profileComplete state
                    router.refresh();

                    // If the hub guard sent the user here to complete registration,
                    // redirect them to the dashboard now that profileComplete is written.
                    if (notice === 'complete-your-hub-registration') {
                        setTimeout(() => router.push("/dashboard"), 1500);
                    }
                }
            } else {
                setSaveMessage({ type: 'error', text: result.error || 'Failed to update profile' });
            }
        } else if (activeTab === 'preferences') {
            const result = await updateNotificationPreferencesAction(userData.notifications);

            if (result.success) {
                setSaveMessage({ type: 'success', text: 'Preferences saved!' });
            } else {
                setSaveMessage({ type: 'error', text: result.error || 'Failed to save preferences' });
            }
        }

        setIsLoading(false);

        // Clear message after 4 seconds
        setTimeout(() => setSaveMessage(null), 4000);
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError("");
        setPasswordSuccess("");

        if (!passwordData.current || !passwordData.new || !passwordData.confirm) {
            setPasswordError("All fields are required");
            return;
        }

        if (passwordData.new !== passwordData.confirm) {
            setPasswordError("New passwords do not match");
            return;
        }

        if (passwordData.new.length < 8) {
            setPasswordError("Password must be at least 8 characters");
            return;
        }

        setIsChangingPassword(true);
        const res = await changePasswordAction(passwordData.current, passwordData.new);
        setIsChangingPassword(false);

        if (res.success) {
            setPasswordSuccess("Password updated successfully!");
            setTimeout(() => {
                setIsChangePasswordModalOpen(false);
                setPasswordData({ current: "", new: "", confirm: "" });
                setPasswordSuccess("");
            }, 2000);
        } else {
            setPasswordError(res.error || "Failed to change password");
        }
    };

    const user = session?.user || {
        name: "User Name",
        email: "user@example.com",
        image: null,
        roles: [] as string[]
    };

    if (isFetching) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8">
            <div className="max-w-4xl mx-auto space-y-8">
                {/* Header */}
                <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900">My Profile</h1>
                        <p className="text-slate-500">Manage your account settings and preferences</p>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={() => router.push("/dashboard")}
                            className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium transition-all"
                        >
                            ← Dashboard
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isLoading}
                            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-all disabled:opacity-50"
                        >
                            {isLoading ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Save className="w-4 h-4" />
                            )}
                            Save Changes
                        </button>
                    </div>
                </div>

                {/* Success/Error Message */}
                {saveMessage && (
                    <div className={`
                        p-4 rounded-xl border flex items-center gap-3
                        ${saveMessage.type === 'success'
                            ? 'bg-green-50 border-green-200 text-green-800'
                            : 'bg-red-50 border-red-200 text-red-800'
                        }
                    `}>
                        <CheckCircle className="w-5 h-5" />
                        <span className="font-medium">{saveMessage.text}</span>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
                    {/* Sidebar / User Card */}
                    <div className="md:col-span-4 space-y-6">
                        {/* User Card */}
                        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                            <div className="flex flex-col items-center text-center">
                                <div 
                                    onClick={handleAvatarClick}
                                    className="relative mb-4 group cursor-pointer"
                                    title="Click to change profile picture"
                                >
                                    <div className="w-24 h-24 rounded-full overflow-hidden bg-slate-100 border-4 border-white shadow-lg flex items-center justify-center">
                                        {isUploadingImage ? (
                                            <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                                        ) : user.image ? (
                                            <Image
                                                src={user.image}
                                                alt={user.name || "User"}
                                                width={96}
                                                height={96}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-slate-400">
                                                <User className="w-10 h-10" />
                                            </div>
                                        )}
                                    </div>
                                    {!isUploadingImage && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                                            <Camera className="w-6 h-6 text-white" />
                                        </div>
                                    )}
                                </div>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleAvatarChange}
                                    accept="image/*"
                                    className="hidden"
                                />
                                <h2 className="text-xl font-bold text-slate-900">{user.name}</h2>
                                <p className="text-sm text-slate-500 capitalize">
                                    {user.roles && user.roles.length > 0 ? user.roles[0] : 'Member'}
                                </p>
                            </div>

                            <div className="mt-6 pt-6 border-t border-slate-100 space-y-4">
                                <div className="flex items-center gap-3 text-sm text-slate-600">
                                    <Mail className="w-4 h-4 text-slate-400" />
                                    <span className="truncate">{user.email}</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-slate-600">
                                    <Shield className="w-4 h-4 text-slate-400" />
                                    <span>Verified Account</span>
                                </div>
                            </div>
                        </div>

                        {/* Navigation Tabs */}
                        <div className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
                            <button
                                onClick={() => setActiveTab('general')}
                                className={`w-full flex items-center gap-3 px-6 py-4 text-sm font-medium transition-colors ${activeTab === 'general'
                                    ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600'
                                    : 'text-slate-600 hover:bg-slate-50 border-l-4 border-transparent'
                                    }`}
                            >
                                <User className="w-4 h-4" />
                                General Information
                            </button>
                            <button
                                onClick={() => setActiveTab('security')}
                                className={`w-full flex items-center gap-3 px-6 py-4 text-sm font-medium transition-colors ${activeTab === 'security'
                                    ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600'
                                    : 'text-slate-600 hover:bg-slate-50 border-l-4 border-transparent'
                                    }`}
                            >
                                <Lock className="w-4 h-4" />
                                Security
                            </button>
                            <button
                                onClick={() => setActiveTab('preferences')}
                                className={`w-full flex items-center gap-3 px-6 py-4 text-sm font-medium transition-colors ${activeTab === 'preferences'
                                    ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600'
                                    : 'text-slate-600 hover:bg-slate-50 border-l-4 border-transparent'
                                    }`}
                            >
                                <Bell className="w-4 h-4" />
                                Preferences
                            </button>
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="md:col-span-8">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2 }}
                            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-8"
                        >
                            {activeTab === 'general' && (
                                <div className="space-y-6">
                                    <h3 className="text-lg font-bold text-slate-900 mb-6">General Information</h3>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-slate-900">First Name</label>
                                            <input
                                                type="text"
                                                value={userData.firstName}
                                                onChange={(e) => setUserData({ ...userData, firstName: e.target.value })}
                                                placeholder="First name"
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-slate-900">Middle / Other Name</label>
                                            <input
                                                type="text"
                                                value={userData.otherName}
                                                onChange={(e) => setUserData({ ...userData, otherName: e.target.value })}
                                                placeholder="Other name (optional)"
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-slate-900">Last Name</label>
                                            <input
                                                type="text"
                                                value={userData.lastName}
                                                onChange={(e) => setUserData({ ...userData, lastName: e.target.value })}
                                                placeholder="Last name"
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-slate-900">Email Address</label>
                                            <input
                                                type="email"
                                                value={userData.email}
                                                onChange={(e) => setUserData({ ...userData, email: e.target.value })}
                                                placeholder="your@email.com"
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                            />
                                            <p className="text-xs text-slate-400">Email changes will require verification before taking effect.</p>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-slate-900">Phone Number</label>
                                            <div className="flex gap-2">
                                                <select
                                                    value={user.roles?.includes('wave_participant') ? "+234" : countryCode}
                                                    onChange={(e) => setCountryCode(e.target.value)}
                                                    disabled={user.roles?.includes('wave_participant')}
                                                    className="w-1/3 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
                                                >
                                                    <option value="+234">🇳🇬 (+234)</option>
                                                    {!user.roles?.includes('wave_participant') && (
                                                        <>
                                                            <option value="+1">🇺🇸/🇨🇦 (+1)</option>
                                                            <option value="+44">🇬🇧 (+44)</option>
                                                            <option value="+233">🇬🇭 (+233)</option>
                                                            <option value="+254">🇰🇪 (+254)</option>
                                                            <option value="+27">🇿🇦 (+27)</option>
                                                            <option value="+91">🇮🇳 (+91)</option>
                                                            <option value="+971">🇦🇪 (+971)</option>
                                                        </>
                                                    )}
                                                </select>
                                                <input
                                                    type="tel"
                                                    value={rawPhone}
                                                    onChange={(e) => setRawPhone(e.target.value)}
                                                    placeholder="801 234 5678"
                                                    className="w-2/3 px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                                                    required
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-slate-900">Gender</label>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={userData.gender ? (userData.gender.charAt(0).toUpperCase() + userData.gender.slice(1)) : "Not Set"}
                                                    disabled
                                                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed transition-all"
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">Locked</span>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-slate-900">Location</label>
                                            <input
                                                type="text"
                                                value={userData.location}
                                                onChange={(e) => setUserData({ ...userData, location: e.target.value })}
                                                placeholder="City, State"
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                            />
                                        </div>
                                        <div className="md:col-span-2 space-y-2">
                                            <label className="text-sm font-medium text-slate-900">Bio</label>
                                            <textarea
                                                rows={4}
                                                value={userData.bio}
                                                onChange={(e) => setUserData({ ...userData, bio: e.target.value })}
                                                placeholder="Tell us about yourself..."
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                                            />
                                        </div>
                                        
                                        {/* Government ID — only visible to non-Nigerian users */}
                                        {!user.roles?.includes('wave_participant') &&
                                         !countryCode.startsWith('+234') && (
                                            <div className="md:col-span-2 space-y-2 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                                                <label className="text-sm font-medium text-slate-900 flex items-center justify-between">
                                                    <span>Government Issued ID (Required for Non-Nigerians)</span>
                                                    {userData.identityDocument && <span className="text-green-600 flex items-center gap-1 text-xs"><CheckCircle className="w-3 h-3" /> Uploaded</span>}
                                                </label>
                                                <p className="text-xs text-slate-500 mb-2">Please upload a valid passport, driver's license, or national ID.</p>
                                                <div className="relative">
                                                    <input 
                                                        type="file" 
                                                        accept=".jpg,.jpeg,.png,.webp,.pdf"
                                                        onChange={async (e) => {
                                                            const file = e.target.files?.[0];
                                                            if (!file) return;
                                                            
                                                            setIsUploadingDoc(true);
                                                            try {
                                                                const formData = new FormData();
                                                                formData.append("file", file);
                                                                formData.append("folder", "kyc");
                                                                
                                                                const res = await fetch("/api/upload", { method: "POST", body: formData });
                                                                const data = await res.json();
                                                                
                                                                if (data.success) {
                                                                    setUserData({ ...userData, identityDocument: data.url });
                                                                } else {
                                                                    alert(data.error || "Failed to upload document");
                                                                }
                                                            } catch (err) {
                                                                alert("An error occurred during upload");
                                                            } finally {
                                                                setIsUploadingDoc(false);
                                                            }
                                                        }}
                                                        disabled={isUploadingDoc}
                                                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                                    />
                                                    {isUploadingDoc && (
                                                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                            <div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                                                        </div>
                                                    )}
                                                </div>
                                                {userData.identityDocument && (
                                                    <a href={userData.identityDocument} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mt-2">
                                                        <FileText className="w-4 h-4" /> View Current Document
                                                    </a>
                                                )}
                                            </div>
                                        )}

                                    </div>
                                </div>
                            )}

                            {activeTab === 'security' && (
                                <div className="space-y-8">
                                    <h3 className="text-lg font-bold text-slate-900">Security Settings</h3>

                                    <div className="pb-8 border-b border-slate-100">
                                        <div className="flex items-center justify-between mb-4">
                                            <div>
                                                <h4 className="font-medium text-slate-900">Password</h4>
                                                <p className="text-sm text-slate-500">Secure your account</p>
                                            </div>
                                            <button 
                                                onClick={() => setIsChangePasswordModalOpen(true)}
                                                className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
                                            >
                                                Change Password
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between mb-4">
                                            <div>
                                                <h4 className="font-medium text-slate-900">Two-Factor Authentication</h4>
                                                <p className="text-sm text-slate-500">Add an extra layer of security to your account</p>
                                            </div>
                                            <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-200 cursor-pointer">
                                                <span className="translate-x-1 inline-block h-4 w-4 transform rounded-full bg-white transition" />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-blue-50 p-4 rounded-xl flex gap-3">
                                        <Shield className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="text-sm font-medium text-blue-900">Security Checkup</p>
                                            <p className="text-xs text-blue-700 mt-1">Your account security score is 85%. Enable 2FA to reach 100%.</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'preferences' && (
                                <div className="space-y-8">
                                    <h3 className="text-lg font-bold text-slate-900">Preferences</h3>



                                    <div>
                                        <h4 className="font-medium text-slate-900 mb-4">Notifications</h4>
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="font-medium text-slate-900">Email Notifications</p>
                                                    <p className="text-xs text-slate-500">Receive updates about your investments</p>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={userData.notifications.email}
                                                    onChange={(e) => setUserData({ ...userData, notifications: { ...userData.notifications, email: e.target.checked } })}
                                                    className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="font-medium text-slate-900">Push Notifications</p>
                                                    <p className="text-xs text-slate-500">Receive real-time alerts on your device</p>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={userData.notifications.push}
                                                    onChange={(e) => setUserData({ ...userData, notifications: { ...userData.notifications, push: e.target.checked } })}
                                                    className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="font-medium text-slate-900">SMS Notifications</p>
                                                    <p className="text-xs text-slate-500">Receive text message updates</p>
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={userData.notifications.sms}
                                                    onChange={(e) => setUserData({ ...userData, notifications: { ...userData.notifications, sms: e.target.checked } })}
                                                    className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </div>
                </div>
            </div>

            {/* Change Password Modal */}
            {isChangePasswordModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-slate-900">Change Password</h3>
                            <button 
                                onClick={() => setIsChangePasswordModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600 transition"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <form onSubmit={handleChangePassword} className="p-6 space-y-4">
                            {passwordError && (
                                <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                                    {passwordError}
                                </div>
                            )}
                            {passwordSuccess && (
                                <div className="p-3 bg-green-50 text-green-600 text-sm rounded-lg border border-green-100 flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4" />
                                    {passwordSuccess}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
                                <input
                                    type="password"
                                    required
                                    value={passwordData.current}
                                    onChange={(e) => setPasswordData({...passwordData, current: e.target.value})}
                                    className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all outline-hidden"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                                <input
                                    type="password"
                                    required
                                    value={passwordData.new}
                                    onChange={(e) => setPasswordData({...passwordData, new: e.target.value})}
                                    className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all outline-hidden"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
                                <input
                                    type="password"
                                    required
                                    value={passwordData.confirm}
                                    onChange={(e) => setPasswordData({...passwordData, confirm: e.target.value})}
                                    className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all outline-hidden"
                                />
                            </div>

                            <div className="pt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsChangePasswordModalOpen(false)}
                                    className="flex-1 py-3 px-4 border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isChangingPassword}
                                    className="flex-1 py-3 px-4 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isChangingPassword ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Updating...
                                        </>
                                    ) : (
                                        "Update Password"
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
