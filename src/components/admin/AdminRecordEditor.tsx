/**
 * One editor for a member's record, on every admin screen that reviews one.
 *
 *   #783 THREE OF THE SIX ADMIN APPLICATION SCREENS HAD NO WAY TO CORRECT
 *        ANYTHING AT ALL, AND A FOURTH HAD TWO BOXES THAT DID NOTHING.
 *
 *   The owner: "ensure all forms that collects data shows admin the same data
 *   that are being collected and when admin clicks edit, admin should be able
 *   to see all the fields and should be able to edit it."
 *
 *   MEASURED across the six screens:
 *
 *       export/applications        no editor
 *       academy/applications       no editor
 *       farm-nation/applications   no editor
 *       marketplace/sellers         5 fields
 *       cooperatives/members       14 fields, 2 of which were dropped
 *       wave/applications          17 fields  (after #775)
 *
 *   The VIEW half was already fine — all six render DynamicDetailModal, which
 *   iterates the stored document, so an admin could SEE everything collected.
 *   What three of them could not do is change any of it, and on a fourth the
 *   "Date of Birth" and "Ward" boxes accepted typing, reported success and
 *   changed nothing, because neither key was on the server's allow-list.
 *
 *   That last one is #775 exactly — "a box whose key the server drops is a box
 *   that silently does nothing" — found again, on a different screen, inside
 *   the work that fixed it. #775's ratchet checked only the WAVE screen.
 *
 * ── WHY ONE COMPONENT ───────────────────────────────────────────────────────
 *
 *   Because six copies is how this started. Each screen grew its own dialog,
 *   its own field list and its own draft state, and they drifted to five, to
 *   fourteen, to seventeen, to none. The field list stays per-module — a seller
 *   has a business name and a WAVE applicant has a next of kin — but the
 *   dialog, the draft seeding, the save and the note are settled here once.
 *
 *   THE SEEDING IS THE PART THAT KEEPS GOING WRONG. #775 found the WAVE screen
 *   loading four fields into a form that drew five, so State and LGA opened
 *   blank on applications that had both. One loop over one list, in here,
 *   cannot do that.
 */

"use client";

import { useState, useEffect } from "react";
import { X, Save, Loader2 } from "lucide-react";
//   #783 ONE path reader, shared with the screens that seed their own drafts.
//   A second copy here is exactly how the field lists drifted.
import { readRecordPath } from "@/lib/admin-editable-fields";

export interface AdminEditableField {
    /** Must be on ALLOWED_EDIT_FIELDS in actions/admin/_applications.ts. */
    key: string;
    label: string;
    /** Rendered full width — addresses and notes. */
    wide?: boolean;
    group?: string;
}

interface Props {
    open: boolean;
    title: string;
    fields: ReadonlyArray<AdminEditableField>;
    /** The stored record. The draft is seeded from THIS, by the same list. */
    record: Record<string, any> | null;
    saving?: boolean;
    onCancel: () => void;
    onSave: (fields: Record<string, string>, editNote: string) => void;
}

export default function AdminRecordEditor({
    open, title, fields, record, saving = false, onCancel, onSave,
}: Props) {
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [note, setNote] = useState("");

    /*
     *   Seeded from the SAME list the form draws. #775's defect was two lists
     *   that disagreed, so there is deliberately no second place to add a field.
     */
    useEffect(() => {
        if (!open) return;
        const seed: Record<string, string> = {};
        for (const { key } of fields) seed[key] = readRecordPath(record, key);
        setDraft(seed);
        setNote("");
    }, [open, record, fields]);

    if (!open) return null;

    const groups = Array.from(new Set(fields.map(f => f.group ?? "Details")));

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
                <div className="p-6 border-b border-slate-200 flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
                        <p className="text-sm text-slate-500 mt-0.5">
                            Changes are logged with a full audit trail, and the member is notified
                        </p>
                    </div>
                    <button onClick={onCancel} aria-label="Close" className="p-2 hover:bg-slate-100 rounded-lg">
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto">
                    {groups.map(group => (
                        <div key={group}>
                            {groups.length > 1 && (
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">{group}</h3>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {fields.filter(f => (f.group ?? "Details") === group).map(({ key, label, wide }) => (
                                    <div key={key} className={wide ? "sm:col-span-2" : ""}>
                                        <label htmlFor={`edit-${key}`} className="block text-sm font-medium text-slate-700 mb-1">
                                            {label}
                                        </label>
                                        <input
                                            id={`edit-${key}`}
                                            type="text"
                                            value={draft[key] ?? ""}
                                            onChange={(e) => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}

                    <div>
                        <label htmlFor="edit-note" className="block text-sm font-medium text-slate-700 mb-1">
                            Edit Note <span className="text-slate-400 font-normal text-xs">(optional — saved to the audit log and shown to the member)</span>
                        </label>
                        <input
                            id="edit-note"
                            type="text"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Reason for this edit..."
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>

                <div className="p-6 border-t border-slate-200 flex justify-end gap-3 shrink-0">
                    <button
                        onClick={onCancel}
                        disabled={saving}
                        className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave(draft, note)}
                        disabled={saving}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
}
