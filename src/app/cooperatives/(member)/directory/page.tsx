/**
 * Cooperative Member Directory
 * 
 * Networking and member lookup
 */

"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Users, Search, MapPin, Filter, Mail, Phone, Loader2 } from "lucide-react";
import { getDirectoryMembersAction } from "@/app/actions/cooperative";
import { startConversationAction, startSupportConversationAction } from "@/app/actions/messages";
import { useToast } from "@/contexts/ToastContext";


export default function CooperativeDirectoryPage() {
    const router = useRouter();
    const { showToast } = useToast();
    const [searchTerm, setSearchTerm] = useState("");
    const [members, setMembers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);

    useEffect(() => {
        async function fetchMembers() {
            const result = await getDirectoryMembersAction();
            if (result.success && result.data?.members) {
                setMembers(result.data.members);
            }
            setLoading(false);
        }
        fetchMembers();
    }, []);

    const handleMessage = async (memberId: string) => {
        setProcessingId(memberId);
        try {
            const result = await startConversationAction(memberId);
            if (result.conversationId) {
                router.push(`/messages?conversation=${result.conversationId}`);
            } else {
                showToast(result.error || "Failed to start conversation", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setProcessingId(null);
        }
    };

    const handleCall = (phone?: string) => {
        if (!phone) {
            showToast("Phone number not available", "error");
            return;
        }
        window.location.href = `tel:${phone}`;
    };

    const handleMessageAdmin = async () => {
        setLoading(true);
        try {
            // Start a support conversation (special action in messages.ts)
            const result = await startSupportConversationAction("cooperative");
            if (result.conversationId) {
                router.push(`/messages?conversation=${result.conversationId}`);
            } else {
                showToast(result.error || "Failed to contact admin", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setLoading(false);
        }
    };

    const filteredMembers = members.filter(member =>
        member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.occupation.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.location.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Users className="w-8 h-8 text-purple-600" />
                        Member Directory
                    </h1>
                    <p className="text-slate-600 mt-1">
                        Connect with other cooperative members
                    </p>
                </div>
                <button 
                    onClick={handleMessageAdmin}
                    className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition-all shadow-md"
                >
                    <Mail className="w-5 h-5" />
                    <span>Contact Admin</span>
                </button>
            </div>

            {/* Search and Filter */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search by name, occupation, or location..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                </div>
                <button className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 hover:text-purple-600">
                    <Filter className="w-4 h-4" />
                    <span>Filter</span>
                </button>
            </div>

            {/* Loading State */}
            {loading && (
                <div className="flex justify-center p-12">
                    <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
                </div>
            )}

            {/* Empty State */}
            {!loading && filteredMembers.length === 0 && (
                <div className="text-center p-12 bg-white rounded-xl">
                    <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-900">No members found</h3>
                    <p className="text-slate-500">Try adjusting your search terms</p>
                </div>
            )}

            {/* Members Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredMembers.map(member => (
                    <div key={member.id} className="bg-white rounded-2xl p-6 shadow-lg border border-slate-200 hover:shadow-xl transition-all group">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-linear-to-br from-purple-600 to-pink-600 rounded-full flex items-center justify-center text-white font-bold text-xl overflow-hidden relative">
                                    {member.image ? (
                                        <Image src={member.image} alt={member.name} fill className="object-cover" />
                                    ) : (
                                        member.name.charAt(0)
                                    )}
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 group-hover:text-purple-600 transition">
                                        {member.name}
                                    </h3>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700`}>
                                        {member.role}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3 mb-6">
                            <div className="flex items-center gap-2 text-slate-600 text-sm">
                                <MapPin className="w-4 h-4 text-slate-400" />
                                {member.location}
                            </div>
                            <div className="flex items-center gap-2 text-slate-600 text-sm">
                                <Users className="w-4 h-4 text-slate-400" />
                                {member.occupation}
                            </div>
                        </div>

                        <div className="flex gap-2 border-t border-slate-200 pt-4">
                            <button 
                                onClick={() => handleMessage(member.id)}
                                disabled={processingId === member.id}
                                className="flex-1 flex items-center justify-center gap-2 py-2 bg-slate-50 rounded-lg text-slate-600 hover:bg-purple-50 hover:text-purple-600 transition text-sm font-medium disabled:opacity-50"
                            >
                                {processingId === member.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Mail className="w-4 h-4" />
                                )}
                                Message
                            </button>
                            <button 
                                onClick={() => handleCall(member.phone)}
                                className="flex-1 flex items-center justify-center gap-2 py-2 bg-slate-50 rounded-lg text-slate-600 hover:bg-green-50 hover:text-green-600 transition text-sm font-medium"
                            >
                                <Phone className="w-4 h-4" />
                                Call
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

