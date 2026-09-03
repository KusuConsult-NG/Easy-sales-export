"use server";

import { requireAdmin } from "@/lib/require-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";

export interface EscalationNote { id: string;
    text: string;
    createdBy: string;
    createdByName: string;
    createdAt: Timestamp | FieldValue; }

/**
 * Add an escalation note to a dispute.
 * Notes are immutable once written (append-only audit trail).
 *
 *   #356 THIS WROTE AN IMMUTABLE NOTE ONTO A MARKETPLACE DISPUTE ON THE
 *        AUTHORITY OF ANY ADMIN ROLE, WHILE THE DISPUTE ITSELF IS GATED ON
 *        finance:resolve_disputes.
 *
 *        The screen that calls this — admin/marketplace/disputes/[id] — also
 *        calls updateDisputeStatusAction and the resolver, and both of those
 *        ask hasAdminPermission(roles, "finance:resolve_disputes"), which
 *        super_admin and admin hold and nobody else does. actions/disputes.ts
 *        says why in its own comment: widening dispute moderation would be "a
 *        bad trade made quietly".
 *
 *        This door was the trade, made quietly, from the other side. An
 *        academy_admin or a wave_admin could append a note that cannot be
 *        edited or removed, and fire a `dispute_escalated` row into the admin
 *        audit log under their own name. That is #276 and #339's shape — the
 *        sibling door on the same screen with the weaker guard.
 *
 *        The WRITE now asks the same permission the rest of the screen's
 *        writes ask. The READ below is left at "any admin", because
 *        getDisputeByIdAction already admits any admin to the dispute itself
 *        and narrowing the notes alone would show a moderator the case with a
 *        hole in it.
 */
export async function addEscalationNoteAction(
    disputeId: string,
    text: string
): Promise<{ success: boolean; data?: { noteId: string }; error?: string }> { if (!text.trim()) return { success: false as const, error: "Note text is required" };
    if (text.length > 2000) return { success: false as const, error: "Note too long (max 2000 chars)" };

    try { const adminCheck = await requireAdmin("finance:resolve_disputes");
        if ("error" in adminCheck) return { success: false as const, error: adminCheck.error, data: undefined };
        const adminId = (adminCheck as { userId: string }).userId;

        // Fetch the admin's display name
        const adminDoc = await db.collection(COLLECTIONS.USERS).doc(adminId).get();
        const adminName = adminDoc.data()?.displayName || adminDoc.data()?.name || "Admin";

        const notesRef = db
            .collection(COLLECTIONS.DISPUTES)
            .doc(disputeId)
            .collection("notes");

        const noteRef = await notesRef.add({ text: text.trim(),
            createdBy: adminId,
            createdByName: adminName,
            createdAt: FieldValue.serverTimestamp() });

        await createAdminAuditLog({ action: "dispute_escalated",
            userId: adminId,
            targetId: disputeId,
            targetType: "dispute",
            metadata: { noteAdded: true, noteId: noteRef.id } });

        return { success: true as const, data: { noteId: noteRef.id } };
    } catch (error: any) { return { success: false as const, error: error.message, data: undefined };
    }
}

/**
 * Fetch all escalation notes for a dispute, ordered by time ascending.
 */
export async function getEscalationNotesAction(
    disputeId: string
): Promise<{ success: true; error: null; data: { notes: EscalationNote[] }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { try {
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { success: false as const, error: adminCheck.error, data: undefined };

        const snap = await db
            .collection(COLLECTIONS.DISPUTES)
            .doc(disputeId)
            .collection("notes")
            .orderBy("createdAt", "asc")
            .get();

        const notes: EscalationNote[] = snap.docs.map(doc => ({ id: doc.id,
            ...(doc.data() as Omit<EscalationNote, "id">) }));

        return { error: null,  success: true as const, data: { notes } };
    } catch (error: any) { return { success: false as const, error: error.message, data: undefined };
    }
}
