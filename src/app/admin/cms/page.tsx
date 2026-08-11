"use client";

/**
 * Announcements & Banners — the admin surface for CMS content.
 *
 * WHY THIS EXISTS
 * ---------------
 * `AnnouncementBanner.tsx` renders announcements and banners across the site,
 * and `cms.ts` has had create/deactivate actions the whole time. There was no
 * page. So the display side was live and the only way to publish anything was
 * to write to the database by hand.
 *
 * This is one of exactly two surfaces where the backend existed and the UI did
 * not — most "unwired" actions turned out to be second implementations of
 * features that already work, and building pages for those would have created
 * competing interfaces.
 *
 * ON THE `adminId` ARGUMENT
 * -------------------------
 * Every action here takes one and every action ignores it: `cms.ts` derives the
 * author from its own `requireAdmin()`, which returns null for anyone who is not
 * an admin. The parameter is passed because the signature demands it, not
 * because it is trusted. Do not start trusting it.
 *
 * WHAT THIS PAGE DOES NOT SHOW
 * ----------------------------
 * Deactivated items. The only read actions are `getActiveAnnouncementsAction`
 * and `getActiveBannersAction`, so this manages what is currently live.
 * Deactivating something removes it from the list rather than greying it out —
 * that is a real limitation, not an oversight, and closing it needs a
 * "get all" action that does not exist yet.
 */

import { useState, useEffect, useCallback } from "react";
import {
    Megaphone,
    Image as ImageIcon,
    Loader2,
    Plus,
    X,
    AlertTriangle,
    Info,
    CheckCircle,
    Siren,
} from "lucide-react";
import {
    createAnnouncementAction,
    getActiveAnnouncementsAction,
    deactivateAnnouncementAction,
    createBannerAction,
    getActiveBannersAction,
    deactivateBannerAction,
    type Announcement,
    type Banner,
} from "@/app/actions/cms";
import { useToast } from "@/contexts/ToastContext";
import { useSession } from "next-auth/react";
import { formatLocalDate } from "@/lib/date-utils";

type AnnouncementType = "info" | "warning" | "success" | "emergency";
type Audience = "all" | "members" | "exporters" | "admins" | "vendors";
type Priority = "low" | "medium" | "high" | "urgent";
type BannerType = "promotional" | "informational" | "alert";
type BannerPosition = "top" | "bottom" | "popup";

const ANNOUNCEMENT_STYLES: Record<AnnouncementType, { icon: typeof Info; className: string }> = {
    info: { icon: Info, className: "bg-blue-50 text-blue-700 border-blue-200" },
    success: { icon: CheckCircle, className: "bg-green-50 text-green-700 border-green-200" },
    warning: { icon: AlertTriangle, className: "bg-amber-50 text-amber-800 border-amber-200" },
    emergency: { icon: Siren, className: "bg-red-50 text-red-700 border-red-200" },
};

export default function CmsPage() {
    const { showToast } = useToast();
    const { data: session } = useSession();
    const adminId = session?.user?.id ?? "";

    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [banners, setBanners] = useState<Banner[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [composing, setComposing] = useState<"announcement" | "banner" | null>(null);

    const [announcement, setAnnouncement] = useState({
        title: "",
        content: "",
        type: "info" as AnnouncementType,
        targetAudience: "all" as Audience,
        priority: "medium" as Priority,
        expiresAt: "",
    });

    const [banner, setBanner] = useState({
        title: "",
        message: "",
        type: "informational" as BannerType,
        link: "",
        buttonText: "",
        startDate: "",
        endDate: "",
        position: "top" as BannerPosition,
    });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            // Both reads are unauthenticated by design — the public site uses
            // them — so a failure here is a genuine error, not a permission one.
            const [a, b] = await Promise.all([
                getActiveAnnouncementsAction("all"),
                getActiveBannersAction(),
            ]);
            setAnnouncements(a ?? []);
            setBanners(b ?? []);
        } catch {
            showToast("Could not load CMS content", "error");
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        load();
    }, [load]);

    async function submitAnnouncement(e: React.FormEvent) {
        e.preventDefault();
        if (!announcement.title.trim() || !announcement.content.trim()) {
            return showToast("A title and message are required", "error");
        }

        setSaving(true);
        try {
            const res: any = await createAnnouncementAction({
                ...announcement,
                title: announcement.title.trim(),
                content: announcement.content.trim(),
                expiresAt: announcement.expiresAt || undefined,
                adminId,
            });

            if (res?.success) {
                showToast("Announcement published", "success");
                setComposing(null);
                setAnnouncement({
                    title: "", content: "", type: "info",
                    targetAudience: "all", priority: "medium", expiresAt: "",
                });
                await load();
            } else {
                showToast(res?.error || "Could not publish the announcement", "error");
            }
        } catch {
            showToast("Could not publish the announcement", "error");
        } finally {
            setSaving(false);
        }
    }

    async function submitBanner(e: React.FormEvent) {
        e.preventDefault();
        if (!banner.title.trim() || !banner.message.trim()) {
            return showToast("A title and message are required", "error");
        }
        if (!banner.startDate || !banner.endDate) {
            // The action stores these as Dates and the public reader filters on
            // them; without both, a banner either never shows or never stops.
            return showToast("A start and end date are required", "error");
        }
        if (new Date(banner.endDate) <= new Date(banner.startDate)) {
            return showToast("The end date must be after the start date", "error");
        }

        setSaving(true);
        try {
            const res: any = await createBannerAction({
                ...banner,
                title: banner.title.trim(),
                message: banner.message.trim(),
                link: banner.link.trim() || undefined,
                buttonText: banner.buttonText.trim() || undefined,
                adminId,
            });

            if (res?.success) {
                showToast("Banner published", "success");
                setComposing(null);
                setBanner({
                    title: "", message: "", type: "informational", link: "",
                    buttonText: "", startDate: "", endDate: "", position: "top",
                });
                await load();
            } else {
                showToast(res?.error || "Could not publish the banner", "error");
            }
        } catch {
            showToast("Could not publish the banner", "error");
        } finally {
            setSaving(false);
        }
    }

    async function takeDown(kind: "announcement" | "banner", id: string) {
        setBusyId(id);
        try {
            const res: any = kind === "announcement"
                ? await deactivateAnnouncementAction(id, adminId)
                : await deactivateBannerAction(id, adminId);

            if (res?.success) {
                showToast("Taken down", "success");
                await load();
            } else {
                showToast(res?.error || "Could not take it down", "error");
            }
        } catch {
            showToast("Could not take it down", "error");
        } finally {
            setBusyId(null);
        }
    }

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-slate-900">Announcements &amp; Banners</h1>
                <p className="text-slate-600 mt-1">
                    Content shown across the platform. Only live items appear here — taking
                    something down removes it from this list.
                </p>
            </div>

            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
            ) : (
                <div className="space-y-10">
                    {/* ─── Announcements ─────────────────────────────────── */}
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                                <Megaphone className="h-5 w-5 text-blue-600" />
                                Announcements
                                <span className="text-sm font-normal text-slate-500">
                                    ({announcements.length} live)
                                </span>
                            </h2>
                            <button
                                onClick={() => setComposing(composing === "announcement" ? null : "announcement")}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                            >
                                <Plus className="h-4 w-4" />
                                New Announcement
                            </button>
                        </div>

                        {composing === "announcement" && (
                            <form onSubmit={submitAnnouncement} className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-5">
                                <input
                                    aria-label="Announcement title"
                                    value={announcement.title}
                                    onChange={(e) => setAnnouncement({ ...announcement, title: e.target.value })}
                                    placeholder="Title"
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                />
                                <textarea
                                    aria-label="Announcement message"
                                    value={announcement.content}
                                    onChange={(e) => setAnnouncement({ ...announcement, content: e.target.value })}
                                    placeholder="Message"
                                    rows={3}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                />
                                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                    <select
                                        aria-label="Type"
                                        value={announcement.type}
                                        onChange={(e) => setAnnouncement({ ...announcement, type: e.target.value as AnnouncementType })}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    >
                                        {(["info", "success", "warning", "emergency"] as const).map((t) => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                    <select
                                        aria-label="Audience"
                                        value={announcement.targetAudience}
                                        onChange={(e) => setAnnouncement({ ...announcement, targetAudience: e.target.value as Audience })}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    >
                                        {(["all", "members", "exporters", "vendors", "admins"] as const).map((a) => (
                                            <option key={a} value={a}>{a}</option>
                                        ))}
                                    </select>
                                    <select
                                        aria-label="Priority"
                                        value={announcement.priority}
                                        onChange={(e) => setAnnouncement({ ...announcement, priority: e.target.value as Priority })}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    >
                                        {(["low", "medium", "high", "urgent"] as const).map((p) => (
                                            <option key={p} value={p}>{p}</option>
                                        ))}
                                    </select>
                                    <input
                                        aria-label="Expires at"
                                        type="date"
                                        value={announcement.expiresAt}
                                        onChange={(e) => setAnnouncement({ ...announcement, expiresAt: e.target.value })}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    />
                                </div>
                                <p className="text-xs text-slate-500">
                                    Leaving the expiry empty means the announcement runs until it is
                                    taken down by hand.
                                </p>
                                <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setComposing(null)} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                                        Cancel
                                    </button>
                                    <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                                        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                                        Publish
                                    </button>
                                </div>
                            </form>
                        )}

                        {announcements.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                                No announcements are live.
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {announcements.map((a) => {
                                    const style = ANNOUNCEMENT_STYLES[a.type as AnnouncementType] ?? ANNOUNCEMENT_STYLES.info;
                                    const Icon = style.icon;
                                    return (
                                        <div key={a.id} className={`flex items-start justify-between gap-4 rounded-xl border p-4 ${style.className}`}>
                                            <div className="flex gap-3">
                                                <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                                                <div>
                                                    <p className="font-semibold">{a.title}</p>
                                                    <p className="mt-1 text-sm opacity-90">{a.content}</p>
                                                    <p className="mt-2 text-xs opacity-75">
                                                        {a.targetAudience} · {a.priority} priority
                                                        {a.expiresAt ? ` · expires ${formatLocalDate(a.expiresAt)}` : " · no expiry"}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => a.id && takeDown("announcement", a.id)}
                                                disabled={busyId === a.id}
                                                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-white/60 disabled:opacity-50"
                                            >
                                                {busyId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Take down"}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    {/* ─── Banners ───────────────────────────────────────── */}
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                                <ImageIcon className="h-5 w-5 text-purple-600" />
                                Banners
                                <span className="text-sm font-normal text-slate-500">
                                    ({banners.length} live)
                                </span>
                            </h2>
                            <button
                                onClick={() => setComposing(composing === "banner" ? null : "banner")}
                                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
                            >
                                <Plus className="h-4 w-4" />
                                New Banner
                            </button>
                        </div>

                        {composing === "banner" && (
                            <form onSubmit={submitBanner} className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-5">
                                <input
                                    aria-label="Banner title"
                                    value={banner.title}
                                    onChange={(e) => setBanner({ ...banner, title: e.target.value })}
                                    placeholder="Title"
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                />
                                <textarea
                                    aria-label="Banner message"
                                    value={banner.message}
                                    onChange={(e) => setBanner({ ...banner, message: e.target.value })}
                                    placeholder="Message"
                                    rows={2}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                />
                                <div className="grid grid-cols-2 gap-3">
                                    <input
                                        aria-label="Link"
                                        value={banner.link}
                                        onChange={(e) => setBanner({ ...banner, link: e.target.value })}
                                        placeholder="Link (optional)"
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    />
                                    <input
                                        aria-label="Button text"
                                        value={banner.buttonText}
                                        onChange={(e) => setBanner({ ...banner, buttonText: e.target.value })}
                                        placeholder="Button text (optional)"
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                    <select
                                        aria-label="Banner type"
                                        value={banner.type}
                                        onChange={(e) => setBanner({ ...banner, type: e.target.value as BannerType })}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    >
                                        {(["informational", "promotional", "alert"] as const).map((t) => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                    <select
                                        aria-label="Position"
                                        value={banner.position}
                                        onChange={(e) => setBanner({ ...banner, position: e.target.value as BannerPosition })}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    >
                                        {(["top", "bottom", "popup"] as const).map((p) => (
                                            <option key={p} value={p}>{p}</option>
                                        ))}
                                    </select>
                                    <input
                                        aria-label="Start date"
                                        type="date"
                                        value={banner.startDate}
                                        onChange={(e) => setBanner({ ...banner, startDate: e.target.value })}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    />
                                    <input
                                        aria-label="End date"
                                        type="date"
                                        value={banner.endDate}
                                        onChange={(e) => setBanner({ ...banner, endDate: e.target.value })}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    />
                                </div>
                                <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setComposing(null)} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                                        Cancel
                                    </button>
                                    <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
                                        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                                        Publish
                                    </button>
                                </div>
                            </form>
                        )}

                        {banners.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                                No banners are live.
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {banners.map((b) => (
                                    <div key={b.id} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
                                        <div>
                                            <p className="font-semibold text-slate-900">{b.title}</p>
                                            <p className="mt-1 text-sm text-slate-600">{b.message}</p>
                                            <p className="mt-2 text-xs text-slate-500">
                                                {b.type} · {b.position}
                                                {b.link ? ` · links to ${b.link}` : ""}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => b.id && takeDown("banner", b.id)}
                                            disabled={busyId === b.id}
                                            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                                        >
                                            {busyId === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Take down"}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}
