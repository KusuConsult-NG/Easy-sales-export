/**
 * Messaging Server Actions (Compatibility Layer)
 * 
 * Server-side wrappers that validate session integrity and delegate execution
 * to the centralized messaging infrastructure layer.
 */

"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Conversation, Message, UserSearchResult } from "@/lib/types/messages";
import * as messagingService from "@/infrastructure/messaging/service";

import { withFlexibleSafeAction } from "@/lib/safe-action";

/**
 * Get all conversations for the current user
 */
export async function getConversationsAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { error: sessionResult.error?.error ?? "Authentication required", conversations: [] };
        }
        const { session } = sessionResult;

        const conversations = await messagingService.getConversations(session.user.id);
        return { conversations, error: null };
    } catch (error: any) {
        logger.error("getConversationsAction error", error);
        return { error: error?.message || "Failed to load conversations", conversations: [] };
    }
}

/**
 * Admin-only: Get ALL conversations across all users
 */
export async function getAllConversationsAdminAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { error: sessionResult.error?.error ?? "Authentication required", conversations: [] };
        }
        const { session } = sessionResult;

        const conversations = await messagingService.getAllConversationsAdmin(session.user.roles || []);
        return { conversations, error: null };
    } catch (error) {
        logger.error("getAllConversationsAdminAction error", error);
        return { error: "Failed to load conversations", conversations: [] };
    }
}

/**
 * Get messages for a specific conversation
 */
export async function getMessagesAction(conversationId: string, limit = 50) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { error: sessionResult.error?.error ?? "Authentication required", messages: [] };
        }
        const { session } = sessionResult;

        const messages = await messagingService.getMessages(
            conversationId, 
            session.user.id, 
            session.user.roles || [], 
            limit
        );
        return { messages, error: null };
    } catch (error: any) {
        logger.error("getMessagesAction error", error);
        return { error: error.message || "Failed to load messages", messages: [] };
    }
}

/**
 * Send a message in a conversation
 */
export async function sendMessageAction(conversationId: string, text: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        }
        const { session } = sessionResult;

        const result = await messagingService.sendMessage(
            conversationId,
            session.user.id,
            session.user.name || "User",
            session.user.email || "",
            session.user.roles || [],
            text
        );
        return { success: true as const, error: null };
    } catch (error: any) {
        logger.error("sendMessageAction error", error);
        return { error: error.message || "Failed to send message", success: false as const, data: null };
    }
}

/**
 * Mark messages as read in a conversation
 */
export async function markAsReadAction(conversationId: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        }
        const { session } = sessionResult;

        await messagingService.markAsRead(conversationId, session.user.id);
        return { success: true as const, error: null };
    } catch (error: any) {
        logger.error("markAsReadAction error", error);
        return { error: error.message || "Failed to mark as read", success: false as const, data: null };
    }
}

/**
 * Start a new conversation with a user
 */
export async function startConversationAction(participantUid: string, productId?: string, orderId?: string, context?: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { error: sessionResult.error?.error ?? "Authentication required", conversationId: null };
        }
        const { session } = sessionResult;

        const conversationId = await messagingService.startConversation(
            session.user.id,
            session.user.name || "User",
            session.user.email || "",
            participantUid,
            productId,
            orderId,
            context
        );
        return { conversationId, error: null };
    } catch (error: any) {
        logger.error("startConversationAction error", error);
        return { error: error.message || "Failed to start conversation", conversationId: null };
    }
}

/**
 * Search for users to start a conversation with (keeps standard matching filters)
 */
export async function searchUsersAction(query: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { error: sessionResult.error?.error ?? "Authentication required", users: [] };
        }
        const { session } = sessionResult;

        const trimmedQuery = query.trim().toLowerCase();
        const ADMIN_ROLES = ["admin", "super_admin", "wave_admin", "cooperative_admin", "marketplace_admin", "export_admin", "farmnation_admin", "academy_admin"];

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userRoles: string[] = userDoc.data()?.roles ?? [];
        const userIsAdmin = userRoles.some(r => r === "admin" || r === "super_admin" || r.endsWith("_admin"));

        const ROLE_MODULE_KEYWORDS: Record<string, string> = {
            wave_participant: "wave",
            cooperative_member: "cooperative",
            academy_participant: "academy",
            marketplace_buyer: "marketplace",
            buyer: "marketplace",
            seller: "marketplace",
            export_participant: "export",
            farmer: "farmnation",
            land_owner: "farmnation",
            investor: "farmnation"
        };

        const userModuleKeywords = userRoles
            .map(role => ROLE_MODULE_KEYWORDS[role])
            .filter(Boolean) as string[];

        if (!trimmedQuery) {
            const adminsSnapshot = await db.collection(COLLECTIONS.USERS)
                .where("roles", "array-contains-any", ADMIN_ROLES)
                .get();

            const admins = adminsSnapshot.docs
                .filter(doc => doc.id !== session.user.id)
                .map(doc => {
                    const userData = doc.data();
                    return {
                        uid: doc.id,
                        fullName: userData.fullName || "Admin",
                        email: userData.email || "",
                        roles: userData.roles || []
                    };
                })
                .filter(admin => {
                    if (userIsAdmin) return true;
                    const email = admin.email.toLowerCase();
                    if (email.includes("super") || email.includes("admin.easysalesexport")) return true;
                    return userModuleKeywords.some(keyword => email.includes(keyword));
                });

            return { users: admins, error: null };
        }

        let adminsSnapshot: any;
        let generalSnapshot: any;
        let exactEmailSnapshot: any;

        try {
            [adminsSnapshot, generalSnapshot, exactEmailSnapshot] = await Promise.all([
                db.collection(COLLECTIONS.USERS).where("roles", "array-contains-any", ADMIN_ROLES).get(),
                db.collection(COLLECTIONS.USERS).orderBy("lastLoginAt", "desc").limit(500).get(),
                db.collection(COLLECTIONS.USERS).where("email", "==", trimmedQuery.toLowerCase()).get()
            ]);
        } catch (e) {
            [adminsSnapshot, generalSnapshot, exactEmailSnapshot] = await Promise.all([
                db.collection(COLLECTIONS.USERS).where("roles", "array-contains-any", ADMIN_ROLES).get(),
                db.collection(COLLECTIONS.USERS).limit(500).get(),
                db.collection(COLLECTIONS.USERS).where("email", "==", trimmedQuery.toLowerCase()).get()
            ]);
        }

        const users: UserSearchResult[] = [];
        const seenIds = new Set<string>([session.user.id]);

        const processDoc = (doc: any) => {
            if (seenIds.has(doc.id)) return;
            const userData = doc.data();
            const fullName = (userData.fullName || "").toLowerCase();
            const email = (userData.email || "").toLowerCase();
            const roles = userData.roles || [];

            const isAdmin = roles.some((r: string) => ADMIN_ROLES.includes(r));
            if (isAdmin && !userIsAdmin) {
                const isGlobal = email.includes("super") || email.includes("admin.easysalesexport");
                const matchesModule = userModuleKeywords.some(keyword => email.includes(keyword));
                if (!isGlobal && !matchesModule) return;
            }

            const matches = fullName.includes(trimmedQuery) || email.includes(trimmedQuery);
            if (matches) {
                users.push({
                    uid: doc.id,
                    fullName: userData.fullName || userData.email || "User",
                    email: userData.email || "",
                    roles: roles
                });
                seenIds.add(doc.id);
            }
        };

        if (exactEmailSnapshot) {
            exactEmailSnapshot.docs.forEach(processDoc);
        }

        adminsSnapshot.docs.forEach(processDoc);
        generalSnapshot.docs.forEach(processDoc);

        return { users, error: null };
    } catch (error) {
        logger.error("Search users error", error);
        return { error: "Failed to search users", users: [] };
    }
}

/**
 * Start a Support conversation with an Administrator
 */
export async function startSupportConversationAction(module?: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { error: sessionResult.error?.error ?? "Authentication required", conversationId: null };
        }
        const { session } = sessionResult;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userRoles: string[] = userDoc.data()?.roles ?? [];

        const ROLE_MODULE_KEYWORDS: Record<string, string> = {
            wave_participant: "wave",
            cooperative_member: "cooperative",
            academy_participant: "academy",
            marketplace_buyer: "marketplace",
            buyer: "marketplace",
            seller: "marketplace",
            export_participant: "export",
            farmer: "farmnation",
            land_owner: "farmnation",
            investor: "farmnation"
        };

        const userModuleKeywords = userRoles
            .map(role => ROLE_MODULE_KEYWORDS[role])
            .filter(Boolean) as string[];
        
        if (module && !userModuleKeywords.includes(module)) {
            userModuleKeywords.unshift(module);
        }

        const adminSnapshot = await db.collection(COLLECTIONS.USERS)
            .where("roles", "array-contains-any", ["admin", "super_admin", "wave_admin", "cooperative_admin", "marketplace_admin", "export_admin", "farmnation_admin", "academy_admin"])
            .get();

        if (adminSnapshot.empty) {
            return { error: "No admin available currently", conversationId: null };
        }

        let targetAdmin = adminSnapshot.docs.find(doc => {
            const email = (doc.data().email || "").toLowerCase();
            return userModuleKeywords.some(keyword => email.includes(keyword));
        });

        if (!targetAdmin) {
            targetAdmin = adminSnapshot.docs.find(doc => {
                const email = (doc.data().email || "").toLowerCase();
                return email.includes("super") || email.includes("admin.easysalesexport");
            });
        }

        if (!targetAdmin) {
            targetAdmin = adminSnapshot.docs[0];
        }

        const adminUid = targetAdmin.id;

        if (adminUid === session.user.id) {
            return { error: "You are an admin", conversationId: null };
        }

        const context = module ? `${module}_support` : "general_support";
        return await startConversationAction(adminUid, undefined, undefined, context);
    } catch (error) {
        logger.error("Start support conversation error", error);
        return { error: "Failed to start support conversation", conversationId: null };
    }
}

export interface ApprovedCoopMember {
    uid: string;
    fullName: string;
    email: string;
    memberNumber: string;
    stateOfOrigin: string;
    gender: string;
    membershipStatus: string;
    approvedAt: string | null;
}

/**
 * Admin-only: Fetch approved cooperative members
 */
export async function getApprovedCooperativeMembersAction(): Promise<{
    success: boolean;
    data: ApprovedCoopMember[];
    error: string | null;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, data: [], error: "Authentication required" };
        }
        const { session } = sessionResult;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const roles: string[] = userDoc.data()?.roles ?? [];
        const isAdmin = roles.some(r => r === "admin" || r === "super_admin" || r.endsWith("_admin"));
        if (!isAdmin) {
            return { success: false, data: [], error: "Access denied" };
        }

        const [activeSnap, approvedSnap] = await Promise.all([
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("membershipStatus", "==", "active")
                .get(),
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("membershipStatus", "==", "approved")
                .get(),
        ]);

        const seen = new Set<string>();
        const members: ApprovedCoopMember[] = [];

        const process = (doc: any) => {
            if (seen.has(doc.id)) return;
            seen.add(doc.id);
            const d = doc.data();
            const joinYear = d.createdAt?.toDate ? d.createdAt.toDate().getFullYear() : new Date().getFullYear();
            const memberNumber = `ESE-COOP-${joinYear}-${doc.id.slice(0, 6).toUpperCase()}`;
            const approvedAt = d.approvedAt?.toDate ? d.approvedAt.toDate().toISOString() : null;

            members.push({
                uid: doc.id,
                fullName: `${d.firstName || ""} ${d.lastName || ""}`.trim() || d.fullName || "—",
                email: d.email || "",
                memberNumber,
                stateOfOrigin: d.stateOfOrigin || "",
                gender: d.gender || "",
                membershipStatus: d.membershipStatus || "active",
                approvedAt,
            });
        };

        activeSnap.docs.forEach(process);
        approvedSnap.docs.forEach(process);

        members.sort((a, b) => a.fullName.localeCompare(b.fullName));
        return { success: true, data: members, error: null };
    } catch (error) {
        logger.error("getApprovedCooperativeMembersAction error:", error);
        return { success: false, data: [], error: "Failed to load members" };
    }
}

/**
 * Admin-only: Broadcast a message to approved cooperative members
 */
export async function broadcastToCooperativeMembersAction(
    memberUids: string[],
    message: string,
): Promise<{
    success: boolean;
    sent: number;
    failed: number;
    errors: string[];
    error: string | null;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, sent: 0, failed: 0, errors: [], error: "Authentication required" };
        }
        const { session } = sessionResult;
        const adminId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(adminId).get();
        const roles: string[] = userDoc.data()?.roles ?? [];
        const isAdmin = roles.some(r => r === "admin" || r === "super_admin" || r.endsWith("_admin"));
        if (!isAdmin) {
            return { success: false, sent: 0, failed: 0, errors: [], error: "Access denied" };
        }

        const trimmedMsg = message.trim();
        if (!trimmedMsg) {
            return { success: false, sent: 0, failed: 0, errors: [], error: "Message cannot be empty" };
        }
        if (memberUids.length === 0) {
            return { success: false, sent: 0, failed: 0, errors: [], error: "No members selected" };
        }

        let sent = 0;
        let failed = 0;
        const errors: string[] = [];

        const adminName = session.user.name || "Easy Sales Export Admin";
        const adminEmail = session.user.email || "";

        for (const memberUid of memberUids) {
            try {
                let conversationId: string | null = null;
                const existingSnap = await db.collection(COLLECTIONS.CONVERSATIONS)
                    .where("participants", "array-contains", adminId)
                    .get();

                for (const doc of existingSnap.docs) {
                    const conv = doc.data();
                    if (
                        conv.participants.includes(memberUid) &&
                        conv.participants.length === 2 &&
                        !conv.productId &&
                        !conv.orderId
                    ) {
                        conversationId = doc.id;
                        break;
                    }
                }

                if (!conversationId) {
                    const memberDoc = await db.collection(COLLECTIONS.USERS).doc(memberUid).get();
                    const memberData = memberDoc.data() || {};

                    const convData = {
                        participants: [adminId, memberUid],
                        participantDetails: {
                            [adminId]: {
                                uid: adminId,
                                name: adminName,
                                email: adminEmail,
                                lastRead: null,
                            },
                            [memberUid]: {
                                uid: memberUid,
                                name: memberData.fullName || memberData.email || "Member",
                                email: memberData.email || "",
                                lastRead: null,
                            },
                        },
                        lastMessage: null,
                        context: "cooperative_broadcast",
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };

                    conversationId = await messagingService.startConversation(
                        adminId,
                        adminName,
                        adminEmail,
                        memberUid,
                        undefined,
                        undefined,
                        "cooperative_broadcast"
                    );
                }

                await messagingService.sendMessage(
                    conversationId,
                    adminId,
                    adminName,
                    adminEmail,
                    roles,
                    trimmedMsg
                );

                sent++;
            } catch (e: any) {
                failed++;
                errors.push(`${memberUid}: ${e.message}`);
                logger.error(`broadcastToCooperativeMembersAction: failed for ${memberUid}`, e);
            }
        }

        return { success: failed === 0, sent, failed, errors, error: null };
    } catch (error) {
        logger.error("broadcastToCooperativeMembersAction error:", error);
        return { success: false, sent: 0, failed: 0, errors: [], error: "Failed to send broadcast" };
    }
}
