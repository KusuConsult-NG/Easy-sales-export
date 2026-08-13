"use server";

import { requireSession } from "@/lib/session-guard";
import { getAdminChatSessions,
    getChatThread,
    resolveSession,
    getChatbotSessionStats,
    type ChatSessionFilters,
    type ChatSessionRow,
    type ChatbotMessageRow } from "@/lib/chatbot-db";
import { logAdminAction } from "@/lib/audit-log";
import { MODULE_CONFIGS, type ChatbotModule } from "@/lib/chatbot-knowledge";

/**
 * The modules to count, taken from the config map rather than written out
 * again. A module added there is counted here without anyone remembering to.
 */
const CHATBOT_MODULES = Object.keys(MODULE_CONFIGS) as ChatbotModule[];

// ─── Guards ──────────────────────────────────────────────────────────────────
async function requireSuperAdmin() { const sessionResult = await requireSession();
    if (!sessionResult.session) throw new Error("Not authenticated");
    const { session } = sessionResult;
    const roles: string[] = session.user.roles ?? [];
    if (!roles.includes("super_admin")) throw new Error("Requires super_admin role");
    return session.user;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export interface ChatSessionsResult { sessions: ChatSessionRow[];
    hasMore: boolean;
    error?: string; }

export async function getChatSessionsAction(
    filters: ChatSessionFilters = {}
): Promise<ChatSessionsResult> { try {
        await requireSuperAdmin();
        const result = await getAdminChatSessions(filters);
        return result;
    } catch (err: any) { return { sessions: [], hasMore: false, error: err.message };
    }
}

export interface ChatThreadResult { messages: ChatbotMessageRow[];
    session: ChatSessionRow | null;
    error?: string; }

export async function getChatThreadAction(
    sessionId: string
): Promise<ChatThreadResult> { try {
        await requireSuperAdmin();
        if (!sessionId) throw new Error("sessionId required");
        const result = await getChatThread(sessionId);
        return result;
    } catch (err: any) { return { messages: [], session: null, error: err.message };
    }
}

export interface ResolveSessionResult { error: string | null; success: boolean; data?: null; }

export async function resolveSessionAction(
    sessionId: string
): Promise<ResolveSessionResult> {
    try {
        const admin = await requireSuperAdmin();
        if (!sessionId) throw new Error("sessionId required");

        const result = await resolveSession(sessionId, admin.id!);
        if (!result.success) throw new Error(result.error);

        // Audit log
        await logAdminAction(
            "chatbot_session_resolved",
            admin.id!,
            sessionId,
            "chatbot_session",
            `Admin resolved chatbot session ${sessionId}`
        );

        return { error: null, success: true as const };
    } catch (err: any) { return { success: false as const, error: err.message };
    }
}

// ─── Stats Aggregation ───────────────────────────────────────────────────────
export interface ChatbotStats { totalSessions: number;
    escalatedUnresolved: number;
    resolvedToday: number;
    mostActiveModule: ChatbotModule | null; }

export async function getChatbotStatsAction(): Promise<ChatbotStats & { error?: string }> { try {
        await requireSuperAdmin();

        // These were counted by fetching rows and taking .length.
        //
        // Three calls to getAdminChatSessions with `limit: 100`, whose page size
        // is hard-capped at Math.min(limit, 100) — so once the platform passed a
        // hundred sessions, totalSessions read exactly 100 and stayed there
        // forever. A stats panel reporting a constant is worse than one
        // reporting an error, because 100 looks like a measurement.
        //
        // Two of those three calls were the same query, run twice.
        //
        // The query also returns `hasMore`, and the caller threw it away: the
        // fact that the number was incomplete was already in hand.
        //
        // Counted in the database now, so these are the real totals — including
        // mostActiveModule, which was previously the busiest module among the
        // hundred most recent sessions rather than overall.
        const stats = await getChatbotSessionStats(CHATBOT_MODULES);

        return { ...stats };
    } catch (err: any) { return { totalSessions: 0, escalatedUnresolved: 0, resolvedToday: 0, mostActiveModule: null, error: err.message };
    }
}
