"use server";

import { auth } from "@/lib/auth";
import {
    getAdminChatSessions,
    getChatThread,
    resolveSession,
    type ChatSessionFilters,
    type ChatSessionRow,
    type ChatbotMessageRow,
} from "@/lib/chatbot-db";
import { logAdminAction } from "@/lib/audit-log";
import type { ChatbotModule } from "@/lib/chatbot-knowledge";

// ─── Guards ──────────────────────────────────────────────────────────────────
async function requireSuperAdmin() {
    const session = await auth();
    if (!session?.user?.id) throw new Error("Not authenticated");
    const roles: string[] = (session.user as any).roles ?? [];
    if (!roles.includes("super_admin")) throw new Error("Requires super_admin role");
    return session.user;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export interface ChatSessionsResult {
    sessions: ChatSessionRow[];
    hasMore: boolean;
    error?: string;
}

export async function getChatSessionsAction(
    filters: ChatSessionFilters = {}
): Promise<ChatSessionsResult> {
    try {
        await requireSuperAdmin();
        const result = await getAdminChatSessions(filters);
        return result;
    } catch (err: any) {
        return { sessions: [], hasMore: false, error: err.message };
    }
}

export interface ChatThreadResult {
    messages: ChatbotMessageRow[];
    session: ChatSessionRow | null;
    error?: string;
}

export async function getChatThreadAction(
    sessionId: string
): Promise<ChatThreadResult> {
    try {
        await requireSuperAdmin();
        if (!sessionId) throw new Error("sessionId required");
        const result = await getChatThread(sessionId);
        return result;
    } catch (err: any) {
        return { messages: [], session: null, error: err.message };
    }
}

export interface ResolveSessionResult {
    success: boolean;
    error?: string;
}

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

        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

// ─── Stats Aggregation ───────────────────────────────────────────────────────
export interface ChatbotStats {
    totalSessions: number;
    escalatedUnresolved: number;
    resolvedToday: number;
    mostActiveModule: ChatbotModule | null;
}

export async function getChatbotStatsAction(): Promise<ChatbotStats & { error?: string }> {
    try {
        await requireSuperAdmin();

        const [all, escalatedUnresolved, allForModule] = await Promise.all([
            getAdminChatSessions({ limit: 100 }),
            getAdminChatSessions({ escalatedOnly: true, unresolvedOnly: true, limit: 100 }),
            getAdminChatSessions({ limit: 100 }),
        ]);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const resolvedToday = allForModule.sessions.filter(
            s => s.resolved && s.lastMessageAt >= today
        ).length;

        // Module frequency
        const moduleCounts: Partial<Record<ChatbotModule, number>> = {};
        for (const s of allForModule.sessions) {
            moduleCounts[s.module] = (moduleCounts[s.module] ?? 0) + 1;
        }
        const mostActiveModule = (Object.entries(moduleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as ChatbotModule) ?? null;

        return {
            totalSessions: all.sessions.length,
            escalatedUnresolved: escalatedUnresolved.sessions.length,
            resolvedToday,
            mostActiveModule,
        };
    } catch (err: any) {
        return { totalSessions: 0, escalatedUnresolved: 0, resolvedToday: 0, mostActiveModule: null, error: err.message };
    }
}
