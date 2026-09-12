"use client";

import { useState } from "react";
import { Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { cleanupAbandonedDraftsAction } from "@/app/actions/maintenance";
import { useToast } from "@/contexts/ToastContext";

export default function MaintenancePage() {
    const [loading, setLoading] = useState(false);
    /**
     *   #680 ONE PANEL, WHICHEVER WAY IT GOES.
     *
     *   The first version of this change rendered a panel only on refusal, and
     *   #609's probe caught it: that suite presses every button on six admin
     *   screens and fails one whose press changes nothing observable. With the
     *   action mocked to succeed, the screen did nothing at all — a dead button
     *   to anyone looking at it, which is a smaller version of the defect this
     *   finding is about.
     */
    const [notice, setNotice] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
    const { showToast } = useToast();

    async function handleCleanup() {
        /*
         *   #680 THE CONFIRM NO LONGER THREATENS A DELETION THAT CANNOT HAPPEN.
         *
         *   It said "Are you sure you want to delete all draft listings older
         *   than 30 days? This action cannot be undone." — in front of an
         *   action whose whole body was a placeholder returning success. A
         *   dialog that cries wolf is one the next dialog inherits, and this
         *   one was asking for consent to something the platform does not do.
         */
        setLoading(true);
        try {
            const response = await cleanupAbandonedDraftsAction();
            if (response.success) {
                //   Unreachable today — the action always refuses — but the
                //   screen must still answer if that ever changes, and a
                //   COUNT rather than a claim: "Cleanup complete!" is what the
                //   placeholder used to render over zero items.
                setNotice({ tone: "info", text: `Removed ${response.count ?? 0} draft listing(s).` });
                showToast(`Removed ${response.count ?? 0} draft listing(s)`, "success");
            } else {
                //   Shown in the panel as well as the toast: it is a paragraph,
                //   and a toast that long is a toast nobody finishes reading.
                setNotice({ tone: "warn", text: response.error || "Cleanup failed" });
                showToast("Draft cleanup is not implemented — see the note above.", "error");
            }
        } catch (error) {
            console.error(error);
            showToast("An unexpected error occurred", "error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                    System Maintenance
                </h1>
                <p className="text-slate-600">
                    Perform system cleanup and optimization tasks
                </p>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {/* Garbage Collection Card */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                            <Trash2 className="w-6 h-6 text-orange-600" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-lg font-bold text-slate-900 mb-1">
                                Garbage Collection
                            </h3>
                            <p className="text-sm text-slate-500 mb-4">
                                {/*
                                  * #680 Says what the button does, which is
                                  * refuse. It used to describe a cleanup that
                                  * was never implemented, above a button that
                                  * reported success for it.
                                  */}
                                Intended to remove abandoned draft land listings that have not been
                                updated in over 30 days. <strong>Not implemented</strong> — pressing
                                this explains why rather than deleting anything. Nothing on this
                                platform removes a member&apos;s records without a decision first.
                            </p>

                            {/*
                              * #680 The green panel is gone with the success it
                              * reported. `result` was only ever set from a
                              * placeholder, so "Cleanup complete! Removed 0
                              * items." was the screen believing a stub. The
                              * refusal arrives as a toast, which is where an
                              * answer the operator has to read belongs.
                              */}
                            {notice && (
                                <div
                                    className={`mb-4 p-4 rounded-xl flex items-start gap-3 ${
                                        notice.tone === "warn" ? "bg-amber-50" : "bg-slate-50"
                                    }`}
                                >
                                    <AlertTriangle
                                        className={`w-5 h-5 shrink-0 mt-0.5 ${
                                            notice.tone === "warn" ? "text-amber-600" : "text-slate-500"
                                        }`}
                                    />
                                    <p
                                        className={`text-sm font-medium ${
                                            notice.tone === "warn" ? "text-amber-800" : "text-slate-700"
                                        }`}
                                    >
                                        {notice.text}
                                    </p>
                                </div>
                            )}

                            <button
                                onClick={handleCleanup}
                                disabled={loading}
                                className="px-4 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Cleaning...
                                    </>
                                ) : (
                                    <>
                                        Run Cleanup
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
