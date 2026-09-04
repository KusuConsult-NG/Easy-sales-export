"use client";

/**
 *   #381 THE SCREEN FOR THE NUMBERS NOBODY COULD CHANGE.
 *
 *        `system_settings` held the platform fee, the order floor and ceiling,
 *        the delivery fee, the USD→NGN rate an export buyer is charged at, and
 *        the WAVE commission. It had three readers and no writer, so all of
 *        them were permanently the constants in lib/system-settings and moving
 *        any of them required a deploy.
 *
 *        The exchange rate is the one that cannot wait for a deploy: export
 *        products are priced in dollars and charged in naira at that rate.
 *
 *        Every field here is rendered from SYSTEM_SETTINGS_FIELDS — the same
 *        definition the server validates against — so the screen cannot offer a
 *        field the action refuses, or omit one it accepts.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Coins, Save, Loader2, AlertCircle } from "lucide-react";
import { getSystemSettingsAction, saveSystemSettingsAction } from "@/app/actions/admin";
import {
    SYSTEM_SETTINGS_DOCS,
    systemSettingsFieldsFor,
    type SystemSettingsDoc,
} from "@/lib/system-settings";
import { logger } from "@/lib/logger";

const GROUP_TITLES: Record<SystemSettingsDoc, { title: string; blurb: string }> = {
    platform_fees: {
        title: "Fees and order limits",
        blurb: "Delivery charges, the platform's cut of a marketplace order, and the smallest and largest order a buyer may place.",
    },
    exchange_rates: {
        title: "Exchange rate",
        blurb: "Export products are priced in dollars. This is the rate they are charged at, and it is stamped onto every order so a past order still shows the rate it used.",
    },
    wave_settings: {
        title: "WAVE commission",
        blurb: "What a WAVE agent earns on an order they brought in.",
    },
};

type Values = Record<string, Record<string, string>>;

export default function AdminFeeSettingsPage() {
    const [values, setValues] = useState<Values>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState<string | null>(null);

    useEffect(() => {
        void load();
    }, []);

    async function load() {
        setLoading(true);
        setError(null);
        try {
            const res = await getSystemSettingsAction() as any;
            if (res?.success && res.data) {
                const next: Values = {};
                for (const doc of SYSTEM_SETTINGS_DOCS) {
                    next[doc] = {};
                    for (const field of systemSettingsFieldsFor(doc)) {
                        next[doc][field.key] = String(res.data[doc]?.[field.key] ?? "");
                    }
                }
                setValues(next);
            } else {
                // #295/#317: a failed load must NOT leave the form showing
                // defaults an admin could then press Save on, overwriting the
                // real stored settings with a guess.
                setError(res?.error || "Could not load system settings");
            }
        } catch (err: any) {
            logger.error("[admin/settings/fees] load failed", err);
            setError("Could not reach the server. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    async function save(doc: SystemSettingsDoc) {
        setSaving(doc);
        try {
            const payload: Record<string, string> = values[doc] ?? {};
            const res = await saveSystemSettingsAction(doc, payload) as any;
            if (res?.success) {
                toast.success(res.message || "Settings saved and applied");
                await load();
            } else {
                // Shown verbatim: the message names the field and the bound it
                // broke, and summarising it away leaves the admin guessing.
                toast.error(res?.error || "Could not save these settings");
            }
        } catch (err: any) {
            logger.error("[admin/settings/fees] save failed", err);
            toast.error("Could not reach the server. Please try again.");
        } finally {
            setSaving(null);
        }
    }

    return (
        <div className="p-8 max-w-3xl">
            <Link href="/admin/settings" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
                &larr; Back to Settings
            </Link>

            <div className="flex items-center gap-3 mb-2">
                <Coins className="w-7 h-7 text-emerald-600" />
                <h1 className="text-3xl font-bold text-slate-900">Fees &amp; Rates</h1>
            </div>
            <p className="text-slate-600 mb-8">
                These apply to live checkouts the moment they are saved.
            </p>

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span className="text-sm">{error}</span>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-24">
                    <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                </div>
            ) : error ? null : (
                <div className="space-y-8">
                    {SYSTEM_SETTINGS_DOCS.map((doc) => (
                        <section key={doc} className="bg-white rounded-2xl shadow-sm p-6">
                            <h2 className="text-lg font-bold text-slate-900">{GROUP_TITLES[doc].title}</h2>
                            <p className="text-sm text-slate-500 mt-1 mb-6">{GROUP_TITLES[doc].blurb}</p>

                            <div className="space-y-5">
                                {systemSettingsFieldsFor(doc).map((field) => (
                                    <div key={field.key}>
                                        <label
                                            htmlFor={`${doc}-${field.key}`}
                                            className="block text-sm font-medium text-slate-700 mb-1"
                                        >
                                            {field.label}
                                            {field.kind === "naira" ? " (₦)" : ""}
                                        </label>
                                        <input
                                            id={`${doc}-${field.key}`}
                                            type="number"
                                            step={field.kind === "rate" ? "0.001" : "1"}
                                            value={values[doc]?.[field.key] ?? ""}
                                            onChange={(e) => setValues((v) => ({
                                                ...v,
                                                [doc]: { ...(v[doc] ?? {}), [field.key]: e.target.value },
                                            }))}
                                            className="w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                                        />
                                        <p className="text-xs text-slate-400 mt-1">{field.help}</p>
                                    </div>
                                ))}
                            </div>

                            <button
                                onClick={() => save(doc)}
                                disabled={saving !== null}
                                className="mt-6 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white font-semibold rounded-xl flex items-center gap-2"
                            >
                                {saving === doc
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <Save className="w-4 h-4" />}
                                Save {GROUP_TITLES[doc].title.toLowerCase()}
                            </button>
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
}
