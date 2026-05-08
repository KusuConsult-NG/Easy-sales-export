"use server";

import { requireAdmin } from "@/lib/require-admin";
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";

export interface EscalationNote {
    id: string;
    text: string;
    createdBy: string;
    createdByName: string;
    createdAt: Timestamp | FieldValue;
}

/**
 * Add an escalation note to a dispute.
 * Notes are immutable once written (append-only audit trail).
 */
export async function addEscalationNoteAction(
    disputeId: string,
    text: string
): Promise<{ success: boolean; data?: { noteId: string }; error?: string }> {
    if (!text.trim()) return { success: false, error: "Note text is required" };
    if (text.length > 2000) return { success: false, error: "Note too long (max 2000 chars)" };

    try {
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { success: false, error: adminCheck.error };
        const adminId = (adminCheck as { userId: string }).userId;

        // Fetch the admin's display name
        const adminDoc = await db.collection(COLLECTIONS.USERS).doc(adminId).get();
        const adminName = adminDoc.data()?.displayName || adminDoc.data()?.name || "Admin";

        const notesRef = db
            .collection(COLLECTIONS.DISPUTES)
            .doc(disputeId)
            .collection("notes");

        const noteRef = await notesRef.add({
            text: text.trim(),
            createdBy: adminId,
            createdByName: adminName,
            createdAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "dispute_escalated",
            userId: adminId,
            targetId: disputeId,
            targetType: "dispute",
            metadata: { noteAdded: true, noteId: noteRef.id },
        });

        return { success: true, data: { noteId: noteRef.id } };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * Fetch all escalation notes for a dispute, ordered by time ascending.
 */
export async function getEscalationNotesAction(
    disputeId: string
): Promise<{ success: boolean; data?: { notes: EscalationNote[] }; error?: string }> {
    try {
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { success: false, error: adminCheck.error };

        const snap = await db
            .collection(COLLECTIONS.DISPUTES)
            .doc(disputeId)
            .collection("notes")
            .orderBy("createdAt", "asc")
            .get();

        const notes: EscalationNote[] = snap.docs.map(doc => ({
            id: doc.id,
            ...(doc.data() as Omit<EscalationNote, "id">),
        }));

        return { success: true, data: { notes } };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
