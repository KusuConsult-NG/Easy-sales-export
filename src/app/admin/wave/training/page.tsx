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
} from "@/app/actions/wave-admin";
import { getWaveTrainingEventsAction, type WaveTrainingEvent } from "@/app/actions/wave";
import { useToast } from "@/contexts/ToastContext";

const STATUS_OPTIONS = [
    { id: "upcoming", label: "Upcoming", color: "blue" },
    { id: "ongoing", label: "Ongoing", color: "green" },
    { id: "completed", label: "Completed", color: "gray" },
    { id: "cancelled", label: "Cancelled", color: "red" },
];

export default function AdminWaveTrainingPage() {
    const router = useRouter();
    const { showToast } = useToast();

    const [events, setEvents] = useState<WaveTrainingEvent[]>([]);
    const [loading, setLoading] = useState(true);
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

    useEffect(() => {
        loadEvents();
    }, []);

    async function loadEvents() {
        setLoading(true);
        try {
            const data = await getWaveTrainingEventsAction();
            setEvents(data);
        } catch (error) {
            showToast("Failed to load events", "error");
        } finally {
            setLoading(false);
        }
    }

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
            date: new Date(event.date).toISOString().slice(0, 16),
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
            if (result.success && result.participants) {
                setParticipants(result.participants);
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
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
            <div className="max-w-7xl mx-auto px-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                            WAVE Training Events Management
                        </h1>
                        <p className="text-gray-600 dark:text-gray-400">
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
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <Calendar className="w-5 h-5 text-blue-600" />
                            <p className="text-sm text-gray-600 dark:text-gray-400">Upcoming</p>
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {upcomingEvents.length}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <p className="text-sm text-gray-600 dark:text-gray-400">Ongoing</p>
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {ongoingEvents.length}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <Calendar className="w-5 h-5 text-gray-600" />
                            <p className="text-sm text-gray-600 dark:text-gray-400">Completed</p>
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">
                            {completedEvents.length}
                        </p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <Users className="w-5 h-5 text-pink-600" />
                            <p className="text-sm text-gray-600 dark:text-gray-400">Total Events</p>
                        </div>
                        <p className="text-3xl font-bold text-gray-900 dark:text-white">{events.length}</p>
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
                                        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                                            {section.title}
                                        </h2>
                                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg divide-y divide-gray-200 dark:divide-gray-700">
                                            {section.items.map((event) => {
                                                const statusColor = getStatusColor(event.status);
                                                return (
                                                    <div key={event.id} className="p-6">
                                                        <div className="flex items-start justify-between mb-4">
                                                            <div className="flex-1">
                                                                <div className="flex items-center gap-3 mb-2">
                                                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                                                        {event.title}
                                                                    </h3>
                                                                    <span
                                                                        className={`px-3 py-1 bg-${statusColor}-100 dark:bg-${statusColor}-900/30 text-${statusColor}-700 dark:text-${statusColor}-300 text-xs font-semibold rounded-full`}
                                                                    >
                                                                        {event.status}
                                                                    </span>
                                                                </div>
                                                                <p className="text-gray-600 dark:text-gray-400 mb-4">
                                                                    {event.description}
                                                                </p>

                                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                                                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                                                                        <Users className="w-4 h-4 text-pink-600" />
                                                                        <span>{event.instructor}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                                                                        <Calendar className="w-4 h-4 text-purple-600" />
                                                                        <span>
                                                                            {new Date(event.date).toLocaleDateString()}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                                                                        <Clock className="w-4 h-4 text-blue-600" />
                                                                        <span>{event.duration}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
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
                                                                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
                                                                    title="View Participants"
                                                                >
                                                                    <Eye className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                                                                </button>
                                                                <button
                                                                    onClick={() => openEditModal(event)}
                                                                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
                                                                    title="Edit Event"
                                                                >
                                                                    <Edit className="w-5 h-5 text-gray-600 dark:text-gray-400" />
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
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-12 text-center">
                        <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                            No Events Yet
                        </h3>
                        <p className="text-gray-600 dark:text-gray-400 mb-6">
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

                {/* Create/Edit Modal */}
                {isModalOpen && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                    {editingEvent ? "Edit Event" : "Create New Event"}
                                </h2>
                                <button
                                    onClick={() => setIsModalOpen(false)}
                                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="p-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        Title *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.title}
                                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        required
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-pink-600"
                                        placeholder="e.g., Export Regulations Workshop"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        Description *
                                    </label>
                                    <textarea
                                        value={formData.description}
                                        onChange={(e) =>
                                            setFormData({ ...formData, description: e.target.value })
                                        }
                                        required
                                        rows={4}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-pink-600"
                                        placeholder="What will participants learn?"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            Instructor *
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.instructor}
                                            onChange={(e) =>
                                                setFormData({ ...formData, instructor: e.target.value })
                                            }
                                            required
                                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-pink-600"
                                            placeholder="Dr. Jane Smith"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            Duration
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.duration}
                                            onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-pink-600"
                                            placeholder="2 hours"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            Date & Time *
                                        </label>
                                        <input
                                            type="datetime-local"
                                            value={formData.date}
                                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                            required
                                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-pink-600"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
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
                                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-pink-600"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        Meeting Link (optional)
                                    </label>
                                    <input
                                        type="url"
                                        value={formData.meetingLink}
                                        onChange={(e) =>
                                            setFormData({ ...formData, meetingLink: e.target.value })
                                        }
                                        className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-pink-600"
                                        placeholder="https://meet.google.com/..."
                                    />
                                </div>

                                {editingEvent && (
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            Status
                                        </label>
                                        <select
                                            value={formData.status}
                                            onChange={(e) =>
                                                setFormData({ ...formData, status: e.target.value as any })
                                            }
                                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-pink-600"
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
                                        className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition"
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
                        <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                    Event Participants
                                </h2>
                                <button
                                    onClick={() => setViewingParticipants(null)}
                                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
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
                                                className="p-4 bg-gray-50 dark:bg-gray-700 rounded-xl flex items-center justify-between"
                                            >
                                                <div>
                                                    <p className="font-semibold text-gray-900 dark:text-white">
                                                        User ID: {participant.userId}
                                                    </p>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                                        Registered:{" "}
                                                        {new Date(participant.registeredAt.toDate()).toLocaleDateString()}
                                                    </p>
                                                </div>
                                                {participant.attended && (
                                                    <CheckCircle className="w-5 h-5 text-green-600" />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-center text-gray-500 dark:text-gray-400 py-8">
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
