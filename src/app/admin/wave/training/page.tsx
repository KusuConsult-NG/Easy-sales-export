"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Plus,
    Edit,
    Trash2,
    Loader2,
    Calendar,
    Users,
    Clock,
    Video,
    MapPin,
    X,
    Eye,
    CheckCircle,
    XCircle,
} from "lucide-react";
import {
    createTrainingEventAction,
    updateTrainingEventAction,
    getEventParticipantsAction,
} from "@/app/actions/wave";
import { getWaveTrainingEventsAction, type WaveTrainingEvent } from "@/app/actions/wave";
import { useToast } from "@/contexts/ToastContext";
import { useAdminData } from "@/hooks/useAdminData";
import { toSafeDate } from "@/lib/utils";

const STATUS_OPTIONS = [
    { id: "upcoming", label: "Upcoming", color: "blue" },
    { id: "ongoing", label: "Ongoing", color: "green" },
    { id: "completed", label: "Completed", color: "gray" },
    { id: "cancelled", label: "Cancelled", color: "red" },
];

export default function AdminWaveTrainingPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const {
        data: events,
        loading,
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        refresh: loadEvents
    } = useAdminData<WaveTrainingEvent>({
        fetchAction: async (opts) => {
            const result = await getWaveTrainingEventsAction(opts.lastDocId, opts.limit || 20);
            return {
                success: result.success,
                data: result.data as any,
                meta: result.meta,
                error: result.error
            };
        },
        limit: 20
    });

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEvent, setEditingEvent] = useState<WaveTrainingEvent | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const [viewingParticipants, setViewingParticipants] = useState<string | null>(null);
    const [participants, setParticipants] = useState<any[]>([]);
    const [loadingParticipants, setLoadingParticipants] = useState(false);

    const [formData, setFormData] = useState({
        title: "",
        description: "",
        instructor: "",
        date: "",
        duration: "",
        maxParticipants: 50,
        meetingLink: "",
        status: "upcoming" as "upcoming" | "ongoing" | "completed" | "cancelled",
    });

    function openCreateModal() {
        setEditingEvent(null);
        setFormData({
            title: "",
            description: "",
            instructor: "",
            date: "",
            duration: "",
            maxParticipants: 50,
            meetingLink: "",
            status: "upcoming",
        });
        setIsModalOpen(true);
    }

    function openEditModal(event: WaveTrainingEvent) {
        setEditingEvent(event);
        setFormData({
            title: event.title,
            description: event.description,
            instructor: event.instructor,
            date: toSafeDate(event.date).toISOString().slice(0, 16),
            duration: event.duration,
            maxParticipants: event.maxParticipants,
            meetingLink: event.meetingLink || "",
            status: event.status,
        });
        setIsModalOpen(true);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!formData.title || !formData.date || !formData.instructor) {
            showToast("Please fill in all required fields", "error");
            return;
        }

        setSubmitting(true);
        try {
            const eventData = {
                ...formData,
                date: new Date(formData.date),
            };

            if (editingEvent && editingEvent.id) {
                // Update
                const result = await updateTrainingEventAction(editingEvent.id, eventData);
                if (result.success) {
                    showToast("Event updated successfully", "success");
                    setIsModalOpen(false);
                    loadEvents();
                } else {
                    showToast(result.error || "Failed to update event", "error");
                }
            } else {
                // Create
                const result = await createTrainingEventAction(eventData);
                if (result.success) {
                    showToast("Event created successfully", "success");
                    setIsModalOpen(false);
                    loadEvents();
                } else {
                    showToast(result.error || "Failed to create event", "error");
                }
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setSubmitting(false);
        }
    }

    async function viewParticipants(eventId: string) {
        setViewingParticipants(eventId);
        setLoadingParticipants(true);
        try {
            const result = await getEventParticipantsAction(eventId);
            if (result.success && result.data?.participants) {
                setParticipants(result.data.participants);
            } else {
                showToast("Failed to load participants", "error");
            }
        } catch (error) {
            showToast("An error occurred", "error");
        } finally {
            setLoadingParticipants(false);
        }
    }

    function getStatusColor(status: string) {
        const option = STATUS_OPTIONS.find((s) => s.id === status);
        return option?.color || "gray";
    }

    const upcomingEvents = events.filter((e) => e.status === "upcoming");
    const ongoingEvents = events.filter((e) => e.status === "ongoing");
    const completedEvents = events.filter((e) => e.status === "completed");
    const cancelledEvents = events.filter((e) => e.status === "cancelled");

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">
                            WAVE Training Events Management
                        </h1>
                        <p className="text-gray-600">
                            Manage workshops, webinars, and training sessions
                        </p>
                    </div>
                    <button
                        onClick={openCreateModal}
                        className="px-6 py-3 bg-pink-600 text-white font-semibold rounded-xl hover:bg-pink-700 transition flex items-center gap-2"
                    >
                        <Plus className="w-5 h-5" />
                        Create Event
                    </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <Calendar className="w-5 h-5 text-blue-600" />
                            <p className="text-sm text-gray-600">Upcoming</p>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">
                            {upcomingEvents.length}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <p className="text-sm text-gray-600">Ongoing</p>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">
                            {ongoingEvents.length}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <Calendar className="w-5 h-5 text-gray-600" />
                            <p className="text-sm text-gray-600">Completed</p>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">
                            {completedEvents.length}
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <Users className="w-5 h-5 text-pink-600" />
                            <p className="text-sm text-gray-600">Total Events</p>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{events.length}</p>
                    </div>
                </div>

                {/* Events List */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-12 h-12 animate-spin text-pink-600" />
                    </div>
                ) : events.length > 0 ? (
                    <div className="space-y-6">
                        {[
                            { title: "Upcoming Events", items: upcomingEvents },
                            { title: "Ongoing Events", items: ongoingEvents },
                            { title: "Completed Events", items: completedEvents },
                        ].map(
                            (section) =>
                                section.items.length > 0 && (
                                    <div key={section.title}>
                                        <h2 className="text-xl font-bold text-gray-900 mb-4">
                                            {section.title}
                                        </h2>
                                        <div className="bg-white rounded-2xl shadow-lg divide-y divide-gray-200">
                                            {section.items.map((event) => {
                                                const statusColor = getStatusColor(event.status);
                                                return (
                                                    <div key={event.id} className="p-6">
                                                        <div className="flex items-start justify-between mb-4">
                                                            <div className="flex-1">
                                                                <div className="flex items-center gap-3 mb-2">
                                                                    <h3 className="text-lg font-bold text-gray-900">
                                                                        {event.title}
                                                                    </h3>
                                                                    <span
                                                                        className={`px-3 py-1 bg-${statusColor}-100${statusColor}-900/30 text-${statusColor}-700${statusColor}-300 text-xs font-semibold rounded-full`}
                                                                    >
                                                                        {event.status}
                                                                    </span>
                                                                </div>
                                                                <p className="text-gray-600 mb-4">
                                                                    {event.description}
                                                                </p>

                                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                                                    <div className="flex items-center gap-2 text-gray-600">
                                                                        <Users className="w-4 h-4 text-pink-600" />
                                                                        <span>{event.instructor}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 text-gray-600">
                                                                        <Calendar className="w-4 h-4 text-purple-600" />
                                                                        <span>
                                                                            {toSafeDate(event.date).toLocaleDateString()}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 text-gray-600">
                                                                        <Clock className="w-4 h-4 text-blue-600" />
                                                                        <span>{event.duration}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 text-gray-600">
                                                                        <Users className="w-4 h-4 text-green-600" />
                                                                        <span>
                                                                            {event.currentParticipants}/{event.maxParticipants}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center gap-2 ml-4">
                                                                <button
                                                                    onClick={() => event.id && viewParticipants(event.id)}
                                                                    className="p-2 hover:bg-gray-100 rounded-lg transition"
                                                                    title="View Participants"
                                                                >
                                                                    <Eye className="w-5 h-5 text-gray-600" />
                                                                </button>
                                                                <button
                                                                    onClick={() => openEditModal(event)}
                                                                    className="p-2 hover:bg-gray-100 rounded-lg transition"
                                                                    title="Edit Event"
                                                                >
                                                                    <Edit className="w-5 h-5 text-gray-600" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )
                        )}
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
                        <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-gray-900 mb-2">
                            No Events Yet
                        </h3>
                        <p className="text-gray-600 mb-6">
                            Create your first training event for WAVE members
                        </p>
                        <button
                            onClick={openCreateModal}
                            className="px-6 py-3 bg-pink-600 text-white font-semibold rounded-xl hover:bg-pink-700 transition"
                        >
                            Create Event
                        </button>
                    </div>
                )}

                {/* Pagination Controls */}
                {events.length > 0 && (
                    <div className="flex items-center justify-between mt-8 p-4 border-t border-gray-200">
                        <span className="text-sm font-medium text-gray-500">Page {pageIndex + 1}</span>
                        <div className="flex gap-2">
                            <button
                                onClick={onPrevPage}
                                disabled={pageIndex === 0 || loading}
                                className="px-4 py-2 border border-gray-200 text-gray-600 font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
                            >
                                Previous
                            </button>
                            <button
                                onClick={onNextPage}
                                disabled={!hasMore || loading}
                                className="px-4 py-2 border border-gray-200 text-gray-600 font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition flex items-center gap-2"
                            >
                                {loading ? <Loader2 className="w-4 h-4 animate-spin text-gray-500" /> : "Next Page"}
                            </button>
                        </div>
                    </div>
                )}

                {/* Create/Edit Modal */}
                {isModalOpen && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                                <h2 className="text-2xl font-bold text-gray-900">
                                    {editingEvent ? "Edit Event" : "Create New Event"}
                                </h2>
                                <button
                                    onClick={() => setIsModalOpen(false)}
                                    className="p-2 hover:bg-gray-100 rounded-lg transition"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="p-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                                        Title *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        required
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-pink-600"
                                        placeholder="e.g., Export Regulations Workshop"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                                        Description *
                                    </label>
                                    <textarea
                                        value={formData.description}
                                        onChange={(e) =>
                                            setFormData({ ...formData, description: e.target.value })
                                        }
                                        required
                                        rows={4}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-pink-600"
                                        placeholder="What will participants learn?"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                            Instructor *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.instructor}
                                            onChange={(e) =>
                                                setFormData({ ...formData, instructor: e.target.value })
                                            }
                                            required
                                            className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-pink-600"
                                            placeholder="Dr. Jane Smith"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                            Duration
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.duration}
                                            onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-pink-600"
                                            placeholder="2 hours"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                            Date & Time *
                                        </label>
                                        <input
                                            type="datetime-local"
                                            value={formData.date}
                                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                            required
                                            className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-pink-600"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                            Max Participants
                                        </label>
                                        <input
                                            type="number"
                                            value={formData.maxParticipants}
                                            onChange={(e) =>
                                                setFormData({
                                                    ...formData,
                                                    maxParticipants: parseInt(e.target.value) || 50,
                                                })
                                            }
                                            className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-pink-600"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                                        Meeting Link (optional)
                                    </label>
                                    <input
                                        type="url"
                                        value={formData.meetingLink}
                                        onChange={(e) =>
                                            setFormData({ ...formData, meetingLink: e.target.value })
                                        }
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-pink-600"
                                        placeholder="https://meet.google.com/..."
                                    />
                                </div>

                                {editingEvent && (
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                                            Status
                                        </label>
                                        <select
                                            value={formData.status}
                                            onChange={(e) =>
                                                setFormData({ ...formData, status: e.target.value as "upcoming" | "ongoing" | "completed" | "cancelled" })
                                            }
                                            className="w-full px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:ring-2 focus:ring-pink-600"
                                        >
                                            {STATUS_OPTIONS.map((opt) => (
                                                <option key={opt.id} value={opt.id}>
                                                    {opt.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className="flex gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={() => setIsModalOpen(false)}
                                        className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={submitting}
                                        className="flex-1 px-4 py-3 bg-pink-600 text-white font-semibold rounded-xl hover:bg-pink-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {submitting ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                Saving...
                                            </>
                                        ) : (
                                            <>{editingEvent ? "Update" : "Create"} Event</>
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Participants Modal */}
                {viewingParticipants && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                                <h2 className="text-2xl font-bold text-gray-900">
                                    Event Participants
                                </h2>
                                <button
                                    onClick={() => setViewingParticipants(null)}
                                    className="p-2 hover:bg-gray-100 rounded-lg transition"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-6">
                                {loadingParticipants ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="w-8 h-8 animate-spin text-pink-600" />
                                    </div>
                                ) : participants.length > 0 ? (
                                    <div className="space-y-3">
                                        {participants.map((participant) => (
                                            <div
                                                key={participant.id}
                                                className="p-4 bg-gray-50 rounded-xl flex items-center justify-between"
                                            >
                                                <div>
                                                    <p className="font-semibold text-gray-900">
                                                        User ID: {participant.userId}
                                                    </p>
                                                    <p className="text-sm text-gray-500">
                                                        Registered:{" "}
                                                        {toSafeDate(participant.registeredAt).toLocaleDateString()}
                                                    </p>
                                                </div>
                                                {participant.attended && (
                                                    <CheckCircle className="w-5 h-5 text-green-600" />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-center text-gray-500 py-8">
                                        No participants yet
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
