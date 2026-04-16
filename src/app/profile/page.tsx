"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import {
    User, Mail, Phone, MapPin, Shield, Bell,
    LogOut, Camera, Save, Lock, CheckCircle
} from "lucide-react";
import Image from "next/image";

import { getUserProfileAction, updateUserProfileAction, updateNotificationPreferencesAction } from "@/app/actions/profile";
import { signOut } from "next-auth/react";
import { useSessionExpiry } from "@/hooks/useSessionExpiry";

export default function ProfilePage() {
    const { data: session } = useSession();

    const { run: guardRun } = useSessionExpiry();
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
        notifications: {
            email: true,
            push: false,
            sms: true
        }
    });

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
                    notifications: p.notifications || { email: true, push: false, sms: true },
                });
            } else if (session?.user) {
                const splitName = (n: string) => { const parts = (n || "").trim().split(/\s+/).filter(Boolean); return { first: parts[0] || "", last: parts.slice(1).join(" ") }; };
                const { first, last } = splitName(session.user.name || "");
                setUserData(prev => ({
                    ...prev,
                    firstName: first,
                    lastName: last,
                    otherName: "",
                    email: session?.user?.email || "",
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
            const sessionEmail = session?.user?.email || "";
            const emailChanged = sessionEmail !== "" && userData.email !== "" && userData.email !== sessionEmail;
            const result = await guardRun(updateUserProfileAction({
                firstName: userData.firstName,
                lastName: userData.lastName,
                otherName: userData.otherName,
                email: userData.email,
                phone: userData.phone,
                location: userData.location,
                bio: userData.bio,
            }));

            if (result.success) {
                if (emailChanged) {
                    // Session JWT is now stale — user must re-login with the new email
                    setSaveMessage({ type: 'success', text: 'Email updated! You will be signed out to apply the change.' });
                    setTimeout(() => signOut({ callbackUrl: "/auth/login" }), 2500);
                } else {
                    setSaveMessage({ type: 'success', text: 'Profile updated successfully!' });
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

        // Clear message after 3 seconds
        setTimeout(() => setSaveMessage(null), 3000);
    };

    const user = session?.user || {
        name: "User Name",
        email: "user@example.com",
        image: null,
        roles: []
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
                                <div className="relative mb-4 group cursor-pointer">
                                    <div className="w-24 h-24 rounded-full overflow-hidden bg-slate-100 border-4 border-white shadow-lg">
                                        {user.image ? (
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
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                                        <Camera className="w-6 h-6 text-white" />
                                    </div>
                                </div>
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
                                            <input
                                                type="tel"
                                                value={userData.phone}
                                                onChange={(e) => setUserData({ ...userData, phone: e.target.value })}
                                                placeholder="+234 000 000 0000"
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                                required
                                            />
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
                                                <p className="text-sm text-slate-500">Last changed 3 months ago</p>
                                            </div>
                                            <button className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
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
        </div>
    );
}
