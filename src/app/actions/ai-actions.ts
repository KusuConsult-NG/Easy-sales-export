"use server";

import { z } from "zod";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { withSafeAction, type ActionResponse } from "@/lib/safe-action";
import * as chatbotService from "@/infrastructure/chatbot/service";
import type { AIChatMessage } from "@/infrastructure/chatbot/service";

export type { AIChatMessage };

/**
 * Zod schema for AI chat message
 */
const aiChatMessageSchema = z.object({ 
    message: z.string().min(1, "Message required").max(2000, "Message too long"),
    context: z.object({
        currentPage: z.string().optional(),
        userRole: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional() 
    }).optional() 
});

/**
 * Send a message to AI and get response
 * Delegates strictly to the secure chatbot infrastructure service
 */
async function _sendAIMessage(
    data: z.infer<typeof aiChatMessageSchema>
): Promise<ActionResponse<{ response: string; chatId: string }>> { 
    const sessionResult = await requireSession();
    if (!sessionResult.session) {
        return { 
            success: false as const, 
            error: sessionResult.error?.error ?? "Authentication required", 
            data: null 
        };
    }
    const { session } = sessionResult;

    try {
        const validated = aiChatMessageSchema.parse(data);

        // Delegate securely to the infrastructure layer, passing verified session roles
        return await chatbotService.sendSecureAIMessage(
            session.user.id,
            session.user.roles || [],
            session.user.name || "User",
            validated.message,
            validated.context
        );
    } catch (error) { 
        if (error instanceof z.ZodError) {
            return { success: false, error: "Validation error", data: null };
        }
        logger.error("AI Chat Action Error:", error);
        return { success: false, error: "Failed to get AI response. Please try again.", data: null };
    }
}

export const sendAIMessage = withSafeAction("sendAIMessage", _sendAIMessage);

/**
 * Get chat history for current user
 */
async function _getAIChatHistory(maxMessages: number = 20): Promise<ActionResponse<{ messages: AIChatMessage[] }>> { 
    const sessionResult = await requireSession();
    if (!sessionResult.session) {
        return { 
            success: false as const, 
            error: sessionResult.error?.error ?? "Authentication required", 
            data: null 
        };
    }
    const { session } = sessionResult;

    try { 
        return await chatbotService.getSecureAIChatHistory(session.user.id, maxMessages);
    } catch (error) { 
        logger.error("AI Chat History Action Error:", error);
        return { success: false, error: "Failed to fetch chat history", data: null };
    }
}

export const getAIChatHistory = withSafeAction("getAIChatHistory", _getAIChatHistory);

/**
 * Get context-aware suggestions based on current page
 */
async function _getAISuggestions(context: { currentPage: string; userRole: string }): Promise<ActionResponse<{ suggestions: string[] }>> { 
    const sessionResult = await requireSession();
    if (!sessionResult.session) {
        return { 
            success: false as const, 
            error: sessionResult.error?.error ?? "Authentication required", 
            data: null 
        };
    }
    const { session } = sessionResult;

    // Use centralized secure implementation
    const suggestions = chatbotService.getContextSuggestions(context.currentPage, session.user.roles || []);

    return { success: true, error: null, data: { suggestions } };
}

export const getAISuggestions = withSafeAction("getAISuggestions", _getAISuggestions);

