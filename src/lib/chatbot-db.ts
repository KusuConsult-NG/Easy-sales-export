/**
 * Chatbot Database Helper (Firebase Admin)
 * 
 * All writes are non-blocking (fire-and-forget) — a Firestore failure
 * NEVER surfaces an error to the user's chat experience.
 * 
 * Phase 13 — AI Chatbot Persistence
 */

import { getAdminDb } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { ChatbotModule } from "@/lib/chatbot-knowledge";
import { logger } from "@/lib/logger";

// ─── Escalation Detection ─────────────────────────────────────────────────
const ESCALATION_PHRASES = [
    "human support",
    "speak to someone",
    "talk to an agent",
    "contact support",
    "real person",
    "call me",
    "whatsapp",
    "phone number",
    "escalate",
    "complaint",
    "speak to a human",
    "i need help now",
];

export function detectEscalation(message: string): boolean {
    const lower = message.toLowerCase();
    return ESCALATION_PHRASES.some(phrase => lower.includes(phrase));
}

// ─── Tag Inference ────────────────────────────────────────────────────────
export function inferTags(message: string): string[] {
    const lower = message.toLowerCase();
    const tags: string[] = [];
    if (lower.match(/payment|paid|deducted|transfer|refund/)) tags.push("payment");
    if (lower.match(/register|signup|join|account/)) tags.push("registration");
    if (lower.match(/verify|verification|kyc|nin|bvn/)) tags.push("verification");
    if (lower.match(/merchant|seller|store|product/)) tags.push("merchant");
    if (lower.match(/export|international|buyer/)) tags.push("export");
    if (lower.match(/course|training|learn|academy/)) tags.push("academy");
    if (lower.match(/cooperative|coop|membership/)) tags.push("cooperative");
    if (lower.match(/wave|empowerment|women/)) tags.push("wave");
    if (lower.match(/farm|land|agriculture/)) tags.push("farm_nation");
    return tags;
}

// ─── Session Management ───────────────────────────────────────────────────

/**
 * Create a new chatbot session document.
 * Called once per widget mount / new conversation.
 */
export async function createChatbotSession(
    sessionId: string,
    userId: string,
    userEmail: string,
    module: ChatbotModule
): Promise<void> {
    try {
        const db = getAdminDb();
        const now = Timestamp.now();
        await db.collection(COLLECTIONS.CHATBOT_SESSIONS).doc(sessionId).set({
            id: sessionId,
            userId,
            userEmail,
            module,
            startedAt: now,
            lastMessageAt: now,
            messageCount: 0,
            escalated: false,
            resolved: false,
            resolvedBy: null,
            resolvedAt: null,
            tags: [],
        });
    } catch (err) {
        // Non-blocking: log but never throw
        logger.error("[chatbot-db] Failed to create session:", err);
    }
}

/**
 * Save a single chat message (user or assistant).
 * Fire-and-forget — never awaited by the API route in the critical path.
 */
export function saveMessageAsync(
    messageId: string,
    sessionId: string,
    userId: string,
    role: "user" | "assistant",
    content: string,
    module: ChatbotModule,
    isEscalation: boolean
): void {
    // Intentionally not awaited — fire-and-forget
    (async () => {
        try {
            const db = getAdminDb();
            const now = Timestamp.now();

            // Write message
            await db.collection(COLLECTIONS.CHATBOT_MESSAGES).doc(messageId).set({
                id: messageId,
                sessionId,
                userId,
                role,
                content,
                module,
                timestamp: now,
                isEscalation,
            });

            // Update session stats
            const sessionRef = db.collection(COLLECTIONS.CHATBOT_SESSIONS).doc(sessionId);
            const updatePayload: Record<string, unknown> = {
                lastMessageAt: now,
                messageCount: FieldValue.increment(1),
            };
            if (isEscalation) {
                updatePayload.escalated = true;
            }
            // Merge tags
            const tags = inferTags(content);
            if (tags.length > 0) {
                updatePayload.tags = FieldValue.arrayUnion(...tags);
            }
            await sessionRef.update(updatePayload);
        } catch (err) {
            logger.error("[chatbot-db] Failed to save message:", err);
        }
    })();
}

/**
 * Mark a session as resolved by an admin.
 */
export async function resolveSession(
    sessionId: string,
    adminId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const db = getAdminDb();
        await db.collection(COLLECTIONS.CHATBOT_SESSIONS).doc(sessionId).update({
            resolved: true,
            resolvedBy: adminId,
            resolvedAt: Timestamp.now(),
        });
        return { success: true };
    } catch (err: any) {
        logger.error("[chatbot-db] Failed to resolve session:", err);
        return { success: false, error: err.message };
    }
}

// ─── Admin Queries ────────────────────────────────────────────────────────

export interface ChatSessionFilters {
    module?: ChatbotModule;
    escalatedOnly?: boolean;
    unresolvedOnly?: boolean;
    limit?: number;
    startAfter?: string; // lastVisible doc ID for cursor pagination
}

export interface ChatSessionRow {
    id: string;
    userId: string;
    userEmail: string;
    module: ChatbotModule;
    startedAt: Date;
    lastMessageAt: Date;
    messageCount: number;
    escalated: boolean;
    resolved: boolean;
}

export async function getAdminChatSessions(
    filters: ChatSessionFilters = {}
): Promise<{ sessions: ChatSessionRow[]; hasMore: boolean }> {
    try {
        const db = getAdminDb();
        const pageSize = Math.min(filters.limit ?? 25, 100);

        let q = db
            .collection(COLLECTIONS.CHATBOT_SESSIONS)
            .orderBy("lastMessageAt", "desc");

        if (filters.module) {
            q = q.where("module", "==", filters.module) as any;
        }
        if (filters.escalatedOnly) {
            q = q.where("escalated", "==", true) as any;
        }
        if (filters.unresolvedOnly) {
            q = q.where("resolved", "==", false) as any;
        }
        if (filters.startAfter) {
            const pivotDoc = await db
                .collection(COLLECTIONS.CHATBOT_SESSIONS)
                .doc(filters.startAfter)
                .get();
            if (pivotDoc.exists) {
                q = q.startAfter(pivotDoc) as any;
            }
        }

        const snapshot = await q.limit(pageSize + 1).get();
        const hasMore = snapshot.docs.length > pageSize;
        const docs = snapshot.docs.slice(0, pageSize);

        const sessions: ChatSessionRow[] = docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                userId: d.userId,
                userEmail: d.userEmail,
                module: d.module,
                startedAt: d.startedAt?.toDate() ?? new Date(),
                lastMessageAt: d.lastMessageAt?.toDate() ?? new Date(),
                messageCount: d.messageCount ?? 0,
                escalated: d.escalated ?? false,
                resolved: d.resolved ?? false,
            };
        });

        return { sessions, hasMore };
    } catch (err) {
        logger.error("[chatbot-db] Failed to fetch sessions:", err);
        return { sessions: [], hasMore: false };
    }
}

export interface ChatbotMessageRow {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
    isEscalation: boolean;
}

export async function getChatThread(
    sessionId: string
): Promise<{ messages: ChatbotMessageRow[]; session: ChatSessionRow | null }> {
    try {
        const db = getAdminDb();

        const [sessionDoc, messagesSnapshot] = await Promise.all([
            db.collection(COLLECTIONS.CHATBOT_SESSIONS).doc(sessionId).get(),
            db.collection(COLLECTIONS.CHATBOT_MESSAGES)
                .where("sessionId", "==", sessionId)
                .orderBy("timestamp", "asc")
                .limit(200)
                .get(),
        ]);

        let session: ChatSessionRow | null = null;
        if (sessionDoc.exists) {
            const d = sessionDoc.data()!;
            session = {
                id: sessionDoc.id,
                userId: d.userId,
                userEmail: d.userEmail,
                module: d.module,
                startedAt: d.startedAt?.toDate() ?? new Date(),
                lastMessageAt: d.lastMessageAt?.toDate() ?? new Date(),
                messageCount: d.messageCount ?? 0,
                escalated: d.escalated ?? false,
                resolved: d.resolved ?? false,
            };
        }

        const messages: ChatbotMessageRow[] = messagesSnapshot.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                role: d.role,
                content: d.content,
                timestamp: d.timestamp?.toDate() ?? new Date(),
                isEscalation: d.isEscalation ?? false,
            };
        });

        return { messages, session };
    } catch (err) {
        logger.error("[chatbot-db] Failed to fetch thread:", err);
        return { messages: [], session: null };
    }
}

/**
 * Delete all chatbot data older than N days.
 * Called from the GDPR purge cron.
 */
export async function purgeChatbotDataOlderThan(days: number): Promise<number> {
    try {
        const db = getAdminDb();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const threshold = Timestamp.fromDate(cutoff);

        // Delete old sessions
        const oldSessions = await db
            .collection(COLLECTIONS.CHATBOT_SESSIONS)
            .where("lastMessageAt", "<=", threshold)
            .limit(400)
            .get();

        if (oldSessions.empty) return 0;

        const batch = db.batch();
        let count = 0;
        const sessionIds: string[] = [];

        for (const doc of oldSessions.docs) {
            batch.delete(doc.ref);
            sessionIds.push(doc.id);
            count++;
        }

        // Delete associated messages for those sessions
        for (const sessionId of sessionIds) {
            const msgs = await db
                .collection(COLLECTIONS.CHATBOT_MESSAGES)
                .where("sessionId", "==", sessionId)
                .limit(400)
                .get();
            for (const msgDoc of msgs.docs) {
                batch.delete(msgDoc.ref);
            }
        }

        await batch.commit();
        return count;
    } catch (err) {
        logger.error("[chatbot-db] Failed to purge chatbot data:", err);
        return 0;
    }
}
