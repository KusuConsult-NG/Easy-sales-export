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

/**
 * The recent turns of a session, for rebuilding model context on the server.
 *
 * /api/ai used to take the conversation history from the request body, which
 * meant the caller wrote the assistant's prior turns. Reading them back from
 * where they were stored is the only version of this that the caller cannot
 * author.
 *
 * Ownership is the caller's to check — this returns what is stored, and
 * `userId` is on every row for exactly that purpose.
 */
export async function getRecentSessionTurns(
    sessionId: string,
    limit: number
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    try {
        const db = getAdminDb();
        const snapshot = await db.collection(COLLECTIONS.CHATBOT_MESSAGES)
            .where("sessionId", "==", sessionId)
            .orderBy("timestamp", "desc")
            .limit(limit)
            .get();

        return snapshot.docs
            .map((d: any) => d.data())
            .reverse()
            .filter((m: any) => m.role === "user" || m.role === "assistant")
            .map((m: any) => ({ role: m.role, content: String(m.content ?? "") }));
    } catch (err) {
        // Non-blocking: a chat with no recalled context is worse than a chat
        // that fails, but only slightly — and failing here would take the
        // assistant down whenever the database hiccups.
        logger.error("[chatbot-db] Failed to load session turns:", err);
        return [];
    }
}

/**
 * Who owns a session, or null if it does not exist.
 */
export async function getSessionOwner(sessionId: string): Promise<string | null> {
    try {
        const db = getAdminDb();
        const doc = await db.collection(COLLECTIONS.CHATBOT_SESSIONS).doc(sessionId).get();
        return doc.exists ? (doc.data()?.userId ?? null) : null;
    } catch (err) {
        logger.error("[chatbot-db] Failed to read session owner:", err);
        return null;
    }
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

        /**
         * THE MESSAGES OUTLIVED THE PURGE THAT WAS SUPPOSED TO DELETE THEM.
         *
         * This is the GDPR retention cron — api/cron/gdpr-purge calls it with 90
         * days. It deleted up to 400 sessions and, for each, up to 400 messages:
         *
         *     const msgs = await db.collection(CHATBOT_MESSAGES)
         *         .where("sessionId", "==", sessionId)
         *         .limit(400)          // ← everything past here survived
         *         .get();
         *
         * A session with more than 400 messages lost its session row and kept
         * the remainder of its messages — the user's own words, retained past
         * the retention period. And permanently: the next run selects sessions
         * by `lastMessageAt`, the session row is gone, so nothing ever looks for
         * those messages again. They are unreachable, undeletable and
         * uncounted.
         *
         * Each session is now drained in pages until it is actually empty.
         *
         * The batch was unbounded too — 400 sessions times up to 400 messages is
         * 160,000 deletes in one commit, the commit most likely to time out, and
         * all-or-nothing so a failure purged nothing at all. Same defect as #177
         * in purgeOldAuditLogs, and the same fix: chunked commits, each standing
         * on its own, so a failure part-way leaves real progress behind.
         */
        const CHUNK = 400;
        let pending = db.batch();
        let pendingOps = 0;
        let count = 0;

        const flushIfFull = async () => {
            if (pendingOps >= CHUNK) {
                await pending.commit();
                pending = db.batch();
                pendingOps = 0;
            }
        };

        for (const doc of oldSessions.docs) {
            // Messages first: if the run dies mid-way, an orphaned SESSION is
            // recoverable (the next run finds it again by lastMessageAt) while
            // an orphaned MESSAGE is not.
            for (;;) {
                const msgs = await db
                    .collection(COLLECTIONS.CHATBOT_MESSAGES)
                    .where("sessionId", "==", doc.id)
                    .limit(CHUNK)
                    .get();
                if (msgs.empty) break;

                for (const msgDoc of msgs.docs) {
                    pending.delete(msgDoc.ref);
                    pendingOps++;
                    await flushIfFull();
                }

                // Commit before re-querying, or the next page returns the same
                // rows: the deletes are only queued, not applied.
                if (pendingOps > 0) {
                    await pending.commit();
                    pending = db.batch();
                    pendingOps = 0;
                }

                if (msgs.docs.length < CHUNK) break;
            }

            pending.delete(doc.ref);
            pendingOps++;
            count++;
            await flushIfFull();
        }

        if (pendingOps > 0) await pending.commit();
        return count;
    } catch (err) {
        logger.error("[chatbot-db] Failed to purge chatbot data:", err);
        return 0;
    }
}

/**
 * Exact counts for the admin chatbot panel.
 *
 * getChatbotStatsAction used to build these by calling getAdminChatSessions
 * three times with `limit: 100` and counting the rows it got back. That query
 * hard-caps its page at `Math.min(limit, 100)` — so once the platform passed a
 * hundred sessions, `totalSessions` read exactly 100 and stayed there. The panel
 * said "Total sessions: 100" indefinitely, which is a number rather than an
 * error and so reads as an answer.
 *
 * It also returned `hasMore`, which the caller discarded. The information that
 * the figure was incomplete was already in hand.
 *
 * These are database counts, so they are the real totals. Seven module counts is
 * seven cheap aggregates, which is what makes an exact `mostActiveModule`
 * affordable rather than a sample of the hundred most recent.
 *
 * `resolvedToday` reads `resolvedAt` — the field resolveSession actually writes.
 * The old version filtered on `lastMessageAt`, so a session resolved this
 * morning whose last message was yesterday did not count, and one resolved last
 * week whose user wrote again today did.
 */
export async function getChatbotSessionStats(modules: readonly ChatbotModule[]): Promise<{
    totalSessions: number;
    escalatedUnresolved: number;
    resolvedToday: number;
    mostActiveModule: ChatbotModule | null;
}> {
    const db = getAdminDb();
    const sessions = () => db.collection(COLLECTIONS.CHATBOT_SESSIONS);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [totalSnap, escalatedSnap, resolvedSnap, ...moduleSnaps] = await Promise.all([
        sessions().count().get(),
        sessions().where("escalated", "==", true).where("resolved", "==", false).count().get(),
        sessions().where("resolved", "==", true).where("resolvedAt", ">=", startOfToday).count().get(),
        ...modules.map(m => sessions().where("module", "==", m).count().get()),
    ]);

    let mostActiveModule: ChatbotModule | null = null;
    let highest = 0;
    modules.forEach((m, i) => {
        const count = moduleSnaps[i]?.data().count ?? 0;
        if (count > highest) {
            highest = count;
            mostActiveModule = m;
        }
    });

    return {
        totalSessions: totalSnap.data().count ?? 0,
        escalatedUnresolved: escalatedSnap.data().count ?? 0,
        resolvedToday: resolvedSnap.data().count ?? 0,
        // Null rather than an arbitrary first module when there are no sessions
        // at all — "no sessions yet" and "hub is busiest" are different answers.
        mostActiveModule,
    };
}
