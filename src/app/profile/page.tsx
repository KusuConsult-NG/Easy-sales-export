"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import {
    User, Mail, Phone, MapPin, Shield, Bell,
    Moon, Sun, LogOut, Camera, Save, Lock, CheckCircle
} from "lucide-react";
import Image from "next/image";
import { useTheme } from "@/contexts/ThemeContext";
import { getUserProfileAction, updateUserProfileAction, updateNotificationPreferencesAction } from "@/app/actions/profile";

export default function ProfilePage() {
    const { data: session } = useSession();
    const { theme, toggleTheme } = useTheme();
    const [activeTab, setActiveTab] = useState<'general' | 'security' | 'preferences'>('general');
    const [isLoading, setIsLoading] = useState(false);
    const [isFetching, setIsFetching] = useState(true);
    const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Real user data from Firestore
    const [userData, setUserData] = useState({
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

            if (result.success && result.profile) {
                setUserData(result.profile);
            }
            setIsFetching(false);
        }

        if (session?.user) {
            loadProfile();
        }
    }, [session]);

    const handleSave = async () => {
        setIsLoading(true);
        setSaveMessage(null);

        // Determine what to save based on active tab
        if (activeTab === 'general') {
            const result = await updateUserProfileAction({
                phone: userData.phone,
                location: userData.location,
                bio: userData.bio,
            });

            if (result.success) {
                setSaveMessage({ type: 'success', text: 'Profile updated successfully!' });
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
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
            <div className="max-w-4xl mx-auto space-y-8">
                {/* Header */}
                <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">My Profile</h1>
                        <p className="text-slate-500 dark:text-slate-400">Manage your account settings and preferences</p>
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
                            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
                            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
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
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                            <div className="flex flex-col items-center text-center">
                                <div className="relative mb-4 group cursor-pointer">
                                    <div className="w-24 h-24 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 border-4 border-white dark:border-slate-800 shadow-lg">
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
                                <h2 className="text-xl font-bold text-slate-900 dark:text-white">{user.name}</h2>
                                <p className="text-sm text-slate-500 dark:text-slate-400 capitalize">
                                    {user.roles && user.roles.length > 0 ? user.roles[0] : 'Member'}
                                </p>
                            </div>

                            <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800 space-y-4">
                                <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
                                    <Mail className="w-4 h-4 text-slate-400" />
                                    <span className="truncate">{user.email}</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
                                    <Shield className="w-4 h-4 text-slate-400" />
                                    <span>Verified Account</span>
                                </div>
                            </div>
                        </div>

                        {/* Navigation Tabs */}
                        <div className="bg-white dark:bg-slate-900 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm">
                            <button
                                onClick={() => setActiveTab('general')}
                                className={`w-full flex items-center gap-3 px-6 py-4 text-sm font-medium transition-colors ${activeTab === 'general'
                                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-l-4 border-blue-600'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border-l-4 border-transparent'
                                    }`}
                            >
                                <User className="w-4 h-4" />
                                General Information
                            </button>
                            <button
                                onClick={() => setActiveTab('security')}
                                className={`w-full flex items-center gap-3 px-6 py-4 text-sm font-medium transition-colors ${activeTab === 'security'
                                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-l-4 border-blue-600'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border-l-4 border-transparent'
                                    }`}
                            >
                                <Lock className="w-4 h-4" />
                                Security
                            </button>
                            <button
                                onClick={() => setActiveTab('preferences')}
                                className={`w-full flex items-center gap-3 px-6 py-4 text-sm font-medium transition-colors ${activeTab === 'preferences'
                                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-l-4 border-blue-600'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border-l-4 border-transparent'
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
                            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 md:p-8"
                        >
                            {activeTab === 'general' && (
                                <div className="space-y-6">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6">General Information</h3>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-slate-900 dark:text-white">Full Name</label>
                                            <input
                                                type="text"
                                                defaultValue={user.name || ''}
                                                disabled
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 cursor-not-allowed"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-slate-900 dark:text-white">Email Address</label>
                                            <input
                                                type="email"
                                                defaultValue={user.email || ''}
                                                disabled
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 cursor-not-allowed"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-slate-900 dark:text-white">Phone Number</label>
                                            <input
                                                type="tel"
                                                value={userData.phone}
                                                onChange={(e) => setUserData({ ...userData, phone: e.target.value })}
                                                placeholder="+234 000 000 0000"
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-slate-900 dark:text-white">Location</label>
                                            <input
                                                type="text"
                                                value={userData.location}
                                                onChange={(e) => setUserData({ ...userData, location: e.target.value })}
                                                placeholder="City, State"
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                            />
                                        </div>
                                        <div className="md:col-span-2 space-y-2">
                                            <label className="text-sm font-medium text-slate-900 dark:text-white">Bio</label>
                                            <textarea
                                                rows={4}
                                                value={userData.bio}
                                                onChange={(e) => setUserData({ ...userData, bio: e.target.value })}
                                                placeholder="Tell us about yourself..."
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'security' && (
                                <div className="space-y-8">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Security Settings</h3>

                                    <div className="pb-8 border-b border-slate-100 dark:border-slate-800">
                                        <div className="flex items-center justify-between mb-4">
                                            <div>
                                                <h4 className="font-medium text-slate-900 dark:text-white">Password</h4>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">Last changed 3 months ago</p>
                                            </div>
                                            <button className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                                                Change Password
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between mb-4">
                                            <div>
                                                <h4 className="font-medium text-slate-900 dark:text-white">Two-Factor Authentication</h4>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">Add an extra layer of security to your account</p>
                                            </div>
                                            <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-200 dark:bg-slate-700 cursor-pointer">
                                                <span className="translate-x-1 inline-block h-4 w-4 transform rounded-full bg-white transition" />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl flex gap-3">
                                        <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="text-sm font-medium text-blue-900 dark:text-blue-200">Security Checkup</p>
                                            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">Your account security score is 85%. Enable 2FA to reach 100%.</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'preferences' && (
                                <div className="space-y-8">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Preferences</h3>

                                    <div className="pb-8 border-b border-slate-100 dark:border-slate-800">
                                        <h4 className="font-medium text-slate-900 dark:text-white mb-4">Theme Settings</h4>
                                        <div className="grid grid-cols-2 gap-4">
                                            <button
                                                onClick={() => theme !== 'light' && toggleTheme()}
                                                className={`flex items-center gap-3 p-4 rounded-xl border ${theme === 'light' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}
                                            >
                                                <Sun className="w-5 h-5" />
                                                <span className="font-medium">Light Mode</span>
                                            </button>
                                            <button
                                                onClick={() => theme !== 'dark' && toggleTheme()}
                                                className={`flex items-center gap-3 p-4 rounded-xl border ${theme === 'dark' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}
                                            >
                                                <Moon className="w-5 h-5" />
                                                <span className="font-medium">Dark Mode</span>
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <h4 className="font-medium text-slate-900 dark:text-white mb-4">Notifications</h4>
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="font-medium text-slate-900 dark:text-white">Email Notifications</p>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">Receive updates about your investments</p>
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
                                                    <p className="font-medium text-slate-900 dark:text-white">Push Notifications</p>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">Receive real-time alerts on your device</p>
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
                                                    <p className="font-medium text-slate-900 dark:text-white">SMS Notifications</p>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">Receive text message updates</p>
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
