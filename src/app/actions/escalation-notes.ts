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
 */
export async function addEscalationNoteAction(
    disputeId: string,
    text: string
): Promise<{ success: boolean; data?: { noteId: string }; error?: string }> { if (!text.trim()) return { success: false as const, error: "Note text is required" };
    if (text.length > 2000) return { success: false as const, error: "Note too long (max 2000 chars)" };

    try { const adminCheck = await requireAdmin();
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
