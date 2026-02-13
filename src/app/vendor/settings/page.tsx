"use client";

import { useState, useEffect } from "react";
import { Store, CreditCard, Bell, Truck, Save, Loader2 } from "lucide-react";
import {
    getVendorSettingsAction,
    updateVendorProfileAction,
    updateVendorPaymentConfigAction,
    updateVendorNotificationPrefsAction,
    updateVendorShippingConfigAction,
} from "@/app/actions/vendor-settings";

type Tab = "profile" | "payment" | "notifications" | "shipping";

export default function VendorSettingsPage() {
    const [activeTab, setActiveTab] = useState<Tab>("profile");
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [settings, setSettings] = useState<any>(null);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // Profile form state
    const [profileForm, setProfileForm] = useState({
        storeName: "",
        description: "",
        category: "",
        contactEmail: "",
        phone: "",
    });

    // Payment form state
    const [paymentForm, setPaymentForm] = useState({
        bankName: "",
        accountNumber: "",
        accountName: "",
        paymentSchedule: "monthly" as "weekly" | "monthly",
        minPayoutThreshold: 10000,
        taxId: "",
    });

    // Notification preferences state
    const [notifPrefs, setNotifPrefs] = useState({
        newOrders: true,
        lowStock: true,
        payments: true,
        reviews: true,
        marketing: false,
    });

    // Shipping form state
    const [shippingForm, setShippingForm] = useState({
        processingDays: 2,
        returnPolicy: "",
        locations: [] as string[],
    });

    useEffect(() => {
        loadSettings();
    }, []);

    async function loadSettings() {
        const result = await getVendorSettingsAction();
        if (result.success && result.settings) {
            setSettings(result.settings);

            if (result.settings.storeInfo) {
                setProfileForm({
                    storeName: result.settings.storeInfo.name || "",
                    description: result.settings.storeInfo.description || "",
                    category: result.settings.storeInfo.category || "",
                    contactEmail: result.settings.storeInfo.contactEmail || "",
                    phone: result.settings.storeInfo.phone || "",
                });
            }

            if (result.settings.paymentConfig) {
                setPaymentForm({
                    bankName: result.settings.paymentConfig.bankName || "",
                    accountNumber: result.settings.paymentConfig.accountNumber || "",
                    accountName: result.settings.paymentConfig.accountName || "",
                    paymentSchedule: result.settings.paymentConfig.paymentSchedule || "monthly",
                    minPayoutThreshold: result.settings.paymentConfig.minPayoutThreshold || 10000,
                    taxId: result.settings.paymentConfig.taxId || "",
                });
            }

            if (result.settings.notifications) {
                setNotifPrefs(result.settings.notifications);
            }

            if (result.settings.shipping) {
                setShippingForm({
                    processingDays: result.settings.shipping.processingDays || 2,
                    returnPolicy: result.settings.shipping.returnPolicy || "",
                    locations: result.settings.shipping.locations || [],
                });
            }
        }
        setIsLoading(false);
    }

    async function handleSaveProfile() {
        setIsSaving(true);
        setMessage(null);
        const result = await updateVendorProfileAction(profileForm);
        setIsSaving(false);

        if (result.success) {
            setMessage({ type: "success", text: "Profile updated successfully!" });
        } else {
            setMessage({ type: "error", text: result.error || "Failed to update profile" });
        }
    }

    async function handleSavePayment() {
        setIsSaving(true);
        setMessage(null);
        const result = await updateVendorPaymentConfigAction(paymentForm);
        setIsSaving(false);

        if (result.success) {
            setMessage({ type: "success", text: "Payment configuration updated!" });
        } else {
            setMessage({ type: "error", text: result.error || "Failed to update payment config" });
        }
    }

    async function handleSaveNotifications() {
        setIsSaving(true);
        setMessage(null);
        const result = await updateVendorNotificationPrefsAction(notifPrefs);
        setIsSaving(false);

        if (result.success) {
            setMessage({ type: "success", text: "Notification preferences updated!" });
        } else {
            setMessage({ type: "error", text: result.error || "Failed to update preferences" });
        }
    }

    async function handleSaveShipping() {
        setIsSaving(true);
        setMessage(null);
        const result = await updateVendorShippingConfigAction(shippingForm);
        setIsSaving(false);

        if (result.success) {
            setMessage({ type: "success", text: "Shipping configuration updated!" });
        } else {
            setMessage({ type: "error", text: result.error || "Failed to update shipping" });
        }
    }

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    const tabs = [
        { id: "profile" as Tab, label: "Store Profile", icon: Store },
        { id: "payment" as Tab, label: "Payment", icon: CreditCard },
        { id: "notifications" as Tab, label: "Notifications", icon: Bell },
        { id: "shipping" as Tab, label: "Shipping", icon: Truck },
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8 px-4">
            <div className="max-w-5xl mx-auto">
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">
                    Vendor Settings
                </h1>

                {/* Tabs */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden">
                    <div className="border-b border-slate-200 dark:border-slate-700">
                        <div className="flex overflow-x-auto">
                            {tabs.map((tab) => {
                                const Icon = tab.icon;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => {
                                            setActiveTab(tab.id);
                                            setMessage(null);
                                        }}
                                        className={`flex items-center gap-2 px-6 py-4 font-semibold border-b-2 transition whitespace-nowrap ${activeTab === tab.id
                                                ? "border-primary text-primary"
                                                : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                            }`}
                                    >
                                        <Icon className="w-5 h-5" />
                                        <span>{tab.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Message */}
                    {message && (
                        <div className={`mx-6 mt-6 p-4 rounded-xl ${message.type === "success"
                                ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                                : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                            }`}>
                            {message.text}
                        </div>
                    )}

                    {/* Tab Content */}
                    <div className="p-6">
                        {activeTab === "profile" && (
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                        Store Name *
                                    </label>
                                    <input
                                        type="text"
                                        value={profileForm.storeName}
                                        onChange={(e) => setProfileForm({ ...profileForm, storeName: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                        placeholder="Your Store Name"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                        Description
                                    </label>
                                    <textarea
                                        value={profileForm.description}
                                        onChange={(e) => setProfileForm({ ...profileForm, description: e.target.value })}
                                        rows={4}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                        placeholder="Tell customers about your store..."
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Category *
                                        </label>
                                        <select
                                            value={profileForm.category}
                                            onChange={(e) => setProfileForm({ ...profileForm, category: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                        >
                                            <option value="">Select category</option>
                                            <option value="agriculture">Agriculture</option>
                                            <option value="food">Food & Beverages</option>
                                            <option value="crafts">Crafts & Handmade</option>
                                            <option value="textiles">Textiles</option>
                                            <option value="other">Other</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Contact Email *
                                        </label>
                                        <input
                                            type="email"
                                            value={profileForm.contactEmail}
                                            onChange={(e) => setProfileForm({ ...profileForm, contactEmail: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                            placeholder="contact@store.com"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                        Phone Number
                                    </label>
                                    <input
                                        type="tel"
                                        value={profileForm.phone}
                                        onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                        placeholder="+234 XXX XXX XXXX"
                                    />
                                </div>

                                <button
                                    onClick={handleSaveProfile}
                                    disabled={isSaving}
                                    className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition disabled:opacity-50"
                                >
                                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                    {isSaving ? "Saving..." : "Save Profile"}
                                </button>
                            </div>
                        )}

                        {activeTab === "payment" && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Bank Name *
                                        </label>
                                        <input
                                            type="text"
                                            value={paymentForm.bankName}
                                            onChange={(e) => setPaymentForm({ ...paymentForm, bankName: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                            placeholder="First Bank of Nigeria"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Account Number *
                                        </label>
                                        <input
                                            type="text"
                                            value={paymentForm.accountNumber}
                                            onChange={(e) => setPaymentForm({ ...paymentForm, accountNumber: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                            placeholder="0123456789"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                        Account Name *
                                    </label>
                                    <input
                                        type="text"
                                        value={paymentForm.accountName}
                                        onChange={(e) => setPaymentForm({ ...paymentForm, accountName: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                        placeholder="Account holder name"
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Payment Schedule
                                        </label>
                                        <select
                                            value={paymentForm.paymentSchedule}
                                            onChange={(e) => setPaymentForm({ ...paymentForm, paymentSchedule: e.target.value as "weekly" | "monthly" })}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                        >
                                            <option value="weekly">Weekly</option>
                                            <option value="monthly">Monthly</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Min Payout Threshold (₦)
                                        </label>
                                        <input
                                            type="number"
                                            value={paymentForm.minPayoutThreshold}
                                            onChange={(e) => setPaymentForm({ ...paymentForm, minPayoutThreshold: parseInt(e.target.value) })}
                                            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                        Tax ID (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={paymentForm.taxId}
                                        onChange={(e) => setPaymentForm({ ...paymentForm, taxId: e.target.value })}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                        placeholder="Tax identification number"
                                    />
                                </div>

                                <button
                                    onClick={handleSavePayment}
                                    disabled={isSaving}
                                    className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition disabled:opacity-50"
                                >
                                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                    {isSaving ? "Saving..." : "Save Payment Config"}
                                </button>
                            </div>
                        )}

                        {activeTab === "notifications" && (
                            <div className="space-y-6">
                                <p className="text-slate-600 dark:text-slate-400">
                                    Choose which notifications you'd like to receive
                                </p>

                                {[
                                    { key: "newOrders", label: "New Orders", desc: "Get notified when you receive a new order" },
                                    { key: "lowStock", label: "Low Stock Alerts", desc: "Alerts when products are running low" },
                                    { key: "payments", label: "Payment Notifications", desc: "Updates on payments and payouts" },
                                    { key: "reviews", label: "Product Reviews", desc: "Notifications for new customer reviews" },
                                    { key: "marketing", label: "Marketing Updates", desc: "Platform news and promotional opportunities" },
                                ].map((notif) => (
                                    <div key={notif.key} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-xl">
                                        <div>
                                            <p className="font-semibold text-slate-900 dark:text-white">{notif.label}</p>
                                            <p className="text-sm text-slate-600 dark:text-slate-400">{notif.desc}</p>
                                        </div>
                                        <button
                                            onClick={() => setNotifPrefs({ ...notifPrefs, [notif.key]: !notifPrefs[notif.key as keyof typeof notifPrefs] })}
                                            className={`relative w-14 h-8 rounded-full transition ${notifPrefs[notif.key as keyof typeof notifPrefs]
                                                    ? "bg-primary"
                                                    : "bg-slate-300 dark:bg-slate-600"
                                                }`}
                                        >
                                            <span
                                                className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full transition-transform ${notifPrefs[notif.key as keyof typeof notifPrefs] ? "translate-x-6" : ""
                                                    }`}
                                            />
                                        </button>
                                    </div>
                                ))}

                                <button
                                    onClick={handleSaveNotifications}
                                    disabled={isSaving}
                                    className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition disabled:opacity-50"
                                >
                                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                    {isSaving ? "Saving..." : "Save Preferences"}
                                </button>
                            </div>
                        )}

                        {activeTab === "shipping" && (
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                        Processing Time (days)
                                    </label>
                                    <input
                                        type="number"
                                        value={shippingForm.processingDays}
                                        onChange={(e) => setShippingForm({ ...shippingForm, processingDays: parseInt(e.target.value) })}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                        min="1"
                                    />
                                    <p className="text-sm text-slate-500 mt-1">Number of days to process orders before shipping</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                        Return Policy
                                    </label>
                                    <textarea
                                        value={shippingForm.returnPolicy}
                                        onChange={(e) => setShippingForm({ ...shippingForm, returnPolicy: e.target.value })}
                                        rows={4}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                        placeholder="Describe your return and refund policy..."
                                    />
                                </div>

                                <button
                                    onClick={handleSaveShipping}
                                    disabled={isSaving}
                                    className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition disabled:opacity-50"
                                >
                                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                    {isSaving ? "Saving..." : "Save Shipping Config"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
