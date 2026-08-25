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
    isEscalation: boolean,
    /**
     * When this message was said, in epoch ms.
     *
     *   #248 THE ASSISTANT'S REPLY COULD SORT ABOVE THE QUESTION IT ANSWERED.
     *
     *        Both halves of a turn are saved by two calls made one line apart,
     *        and each used to stamp its own Timestamp.now(). That has
     *        MILLISECOND precision (firestore-compat), and the second closure
     *        runs as soon as the first awaits — microseconds later. The two rows
     *        therefore carried the SAME timestamp, essentially always, and the
     *        readers order on `timestamp` alone. The tie was broken by whatever
     *        the database returned first: an admin reading an escalated
     *        complaint could be shown the answer above the question, and
     *        getRecentSessionTurns replays that same order to the model as
     *        conversation history.
     *
     *        The caller already knew the order — the message ids are built from
     *        `Date.now()` and `Date.now() + 1`. Nothing used it. Passing the
     *        value the ids were derived from makes the two rows distinct.
     *
     * Optional so the fallback stays Timestamp.now() for any caller that has no
     * particular moment in mind.
     */
    timestampMs?: number,
    /** Recorded only when the session row has to be reconstituted — see below. */
    userEmail?: string,
): void {
    // Intentionally not awaited — fire-and-forget
    (async () => {
        try {
            const db = getAdminDb();
            const now = timestampMs === undefined
                ? Timestamp.now()
                : Timestamp.fromMillis(timestampMs);

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

            /**
             *   #246 A FAILED SESSION CREATE ORPHANED EVERY MESSAGE IN THAT
             *        CONVERSATION.
             *
             *        This was `sessionRef.update(updatePayload)`. An update
             *        against a missing row is a documented SILENT NO-OP in this
             *        adapter — zero rows matched, no error raised — and
             *        createChatbotSession swallows its own failure by design
             *        (see the file header: a database error never surfaces in
             *        the user's chat). So one transient error at create time
             *        produced a conversation that:
             *
             *          - never appeared in the admin panel, which lists SESSIONS;
             *          - never counted as escalated, however plainly the user
             *            asked for a human, because `escalated: true` went to
             *            the row that was not there;
             *          - was never deleted by the 90-day GDPR purge, which finds
             *            messages THROUGH their session. No session row means
             *            nothing looks for those messages again — unreachable,
             *            undeletable, retained past the retention period.
             *
             *        That last one is #191 arriving by a different road.
             *
             *        The row is rebuilt instead. The read is what makes it safe
             *        to distinguish "increment the existing session" from
             *        "this session is missing its document": a bare set(merge)
             *        would reset `startedAt` on every single message.
             */
            const existing = await sessionRef.get();
            if (existing.exists) {
                await sessionRef.update(updatePayload);
            } else {
                logger.warn("[chatbot-db] session document missing — rebuilding it", { sessionId });
                await sessionRef.set({
                    id: sessionId,
                    userId,
                    userEmail: userEmail ?? null,
                    module,
                    startedAt: now,
                    resolved: false,
                    resolvedBy: null,
                    resolvedAt: null,
                    escalated: false,
                    tags: [],
                    // lastMessageAt, the count and any escalation/tags from this
                    // message go on top. merge, so a session that raced into
                    // existence between the read and here keeps its own fields.
                    ...updatePayload,
                }, { merge: true });
            }
        } catch (err) {
            logger.error("[chatbot-db] Failed to save message:", err);
        }
    })();
}

/**
 * Mark a session as resolved by an admin.
 *
 *   #247 RESOLVING A SESSION THAT DOES NOT EXIST REPORTED SUCCESS.
 *
 *        This was a bare `.update()`, and an update against a missing row is a
 *        SILENT NO-OP in this adapter. So it returned { success: true } for any
 *        id at all: the admin page showed the resolve as having worked, and the
 *        caller wrote "Admin resolved chatbot session <id>" into the permanent
 *        audit record for a session nobody had resolved.
 *
 *        The realistic way in is not a typo. It is an escalated session the
 *        90-day purge has already deleted, still open in a stale admin tab —
 *        the click succeeds, and the escalation is neither resolved nor still
 *        listed as needing attention.
 *
 *        `alreadyResolved` exists so the caller can skip the audit row for a
 *        second click. Overwriting resolvedBy would name the wrong admin in the
 *        record, which is the defect this audit already fixed once for disputes.
 */
export async function resolveSession(
    sessionId: string,
    adminId: string
): Promise<{ success: boolean; error?: string; alreadyResolved?: boolean }> {
    try {
        const db = getAdminDb();
        const ref = db.collection(COLLECTIONS.CHATBOT_SESSIONS).doc(sessionId);

        const snap = await ref.get();
        if (!snap.exists) {
            return { success: false, error: "Chat session not found" };
        }
        if (snap.data()?.resolved === true) {
            // The first resolver stands.
            return { success: true, alreadyResolved: true };
        }

        await ref.update({
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

/**
 * Put one turn's two rows in the order they were said.
 *
 * Ordering by `timestamp` alone is not enough for rows written BEFORE #248: the
 * question and its answer share a millisecond, so the tie is broken by whatever
 * the database returns first. Within a single millisecond the user's message
 * always precedes the assistant's — the reply is generated in response to it —
 * so that is the tiebreak, applied after the query rather than in it, because
 * it exists to correct data already stored.
 */
function inSpokenOrder<T extends { role?: string; timestamp?: any }>(rows: T[]): T[] {
    const ms = (t: any): number => {
        if (!t) return 0;
        if (typeof t?.toDate === "function") return t.toDate().getTime();
        const d = new Date(t);
        return Number.isNaN(d.getTime()) ? 0 : d.getTime();
    };
    const rank = (r?: string) => (r === "user" ? 0 : 1);
    return [...rows].sort((a, b) => ms(a.timestamp) - ms(b.timestamp) || rank(a.role) - rank(b.role));
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

        // inSpokenOrder rather than .reverse(): the query takes the most recent
        // N descending, so it has to be flipped, and a tie in `timestamp` — the
        // shape of every turn written before #248 — has to be broken the same
        // way the admin transcript breaks it. This context is replayed to the
        // model, so an inverted pair tells it the user answered its question.
        return inSpokenOrder(snapshot.docs.map((d: any) => d.data()))
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

        // inSpokenOrder over the query's own ascending order: within a single
        // millisecond — which is how every turn written before #248 is stored —
        // `orderBy("timestamp")` leaves the tie to the database, and an admin
        // reading an escalated complaint can be shown the answer above the
        // question.
        const rows = messagesSnapshot.docs.map(
            doc => ({ ...doc.data(), id: doc.id }) as Record<string, any>);

        const messages: ChatbotMessageRow[] = inSpokenOrder(rows).map(d => ({
            id: d.id,
            role: d.role,
            content: d.content,
            timestamp: d.timestamp?.toDate?.() ?? new Date(d.timestamp ?? Date.now()),
            isEscalation: d.isEscalation ?? false,
        }));

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

        if (pendingOps > 0) {
            await pending.commit();
            pending = db.batch();
            pendingOps = 0;
        }

        /**
         * And the messages no session can reach (#246).
         *
         * The loop above finds messages THROUGH their session. A message whose
         * session document is missing — which is what a failed
         * createChatbotSession used to produce, and what a run interrupted
         * between deleting a session and draining its messages produces — is
         * unreachable by that route, so it was retained past the retention
         * period, permanently.
         *
         * A message carries its own `timestamp`, so it can be selected on its
         * own terms. Doing that unconditionally makes the sweep independent of
         * whether any session row survived, which is the property that was
         * missing. Bounded to one page per run: this is a backstop for a
         * population that should be empty, not the main path.
         */
        const strandedMessages = await db
            .collection(COLLECTIONS.CHATBOT_MESSAGES)
            .where("timestamp", "<=", threshold)
            .limit(CHUNK)
            .get();

        if (!strandedMessages.empty) {
            logger.warn(
                `[chatbot-db] purging ${strandedMessages.docs.length} message(s) past retention with no reachable session`);
            for (const msgDoc of strandedMessages.docs) {
                pending.delete(msgDoc.ref);
                pendingOps++;
                await flushIfFull();
            }
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
