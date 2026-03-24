"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import { getUsersAction, manualAcademyEnrollmentAction } from "@/app/actions/admin";
import { useToast } from "@/contexts/ToastContext";
import { Loader2, Search, User as UserIcon, Check } from "lucide-react";

interface EnrollStudentModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function EnrollStudentModal({ isOpen, onClose }: EnrollStudentModalProps) {
    const { showToast } = useToast();
    const [searchQuery, setSearchQuery] = useState("");
    const [isSearching, setIsSearching] = useState(false);
    const [users, setUsers] = useState<any[]>([]);
    const [selectedUser, setSelectedUser] = useState<any | null>(null);
    const [plan, setPlan] = useState<"foundation" | "standard" | "elite">("foundation");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        const res = await getUsersAction({ search: searchQuery, limit: 10 });
        if (res.success && res.users) {
            setUsers(res.users);
            if (res.users.length === 0) {
                showToast("No users found matching that email/phone/name", "error");
            }
        } else {
            showToast(res.error || "Failed to search users", "error");
        }
        setIsSearching(false);
    };

    const handleEnroll = async () => {
        if (!selectedUser) {
            showToast("Please select a user first", "error");
            return;
        }

        setIsSubmitting(true);
        const res = await manualAcademyEnrollmentAction(selectedUser.id, plan);
        if (res.success) {
            showToast("Student enrolled successfully", "success");
            onClose();
            // Reset state
            setSearchQuery("");
            setUsers([]);
            setSelectedUser(null);
        } else {
            showToast(res.error || "Failed to enroll student", "error");
        }
        setIsSubmitting(false);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add Student to Academy" maxWidth="md">
            <div className="space-y-6 mt-4">
                {/* Search User */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        Search User (Email, Phone, or Name)
                    </label>
                    <form onSubmit={handleSearch} className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Enter exact email or search name..."
                                className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={isSearching || !searchQuery.trim()}
                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium transition disabled:opacity-50"
                        >
                            {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : "Search"}
                        </button>
                    </form>
                </div>

                {/* Search Results */}
                {users.length > 0 && (
                    <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                        {users.map(u => (
                            <div
                                key={u.id}
                                onClick={() => setSelectedUser(u)}
                                className={`p-4 flex items-center justify-between cursor-pointer transition-colors ${
                                    selectedUser?.id === u.id ? "bg-blue-50" : "hover:bg-slate-50"
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                        <UserIcon className="w-5 h-5 text-slate-500" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-slate-900">{u.fullName || u.name || "Unknown User"}</p>
                                        <p className="text-sm text-slate-500">{u.email}</p>
                                    </div>
                                </div>
                                {selectedUser?.id === u.id && (
                                    <Check className="w-5 h-5 text-blue-600" />
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Select Plan */}
                {selectedUser && (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Select Academy Plan
                        </label>
                        <select
                            value={plan}
                            onChange={(e) => setPlan(e.target.value as any)}
                            className="w-full px-4 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                            <option value="foundation">Foundation (Free)</option>
                            <option value="standard">Standard</option>
                            <option value="elite">Elite</option>
                        </select>
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 rounded-xl font-semibold text-slate-600 hover:bg-slate-100 transition"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleEnroll}
                        disabled={!selectedUser || isSubmitting}
                        className="px-5 py-2.5 rounded-xl font-semibold bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50 flex items-center gap-2"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" /> Enrolling...
                            </>
                        ) : (
                            "Enroll Student"
                        )}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
