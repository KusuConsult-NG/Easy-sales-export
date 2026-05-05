/**
 * Messaging Server Actions
 * 
 * Server-side functions for managing conversations and messages
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import type { Conversation, Message, UserSearchResult } from "@/lib/types/messages";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { serializeDocs } from "@/lib/firestore-serialize";

/**
 * Get all conversations for the current user
 */
export async function getConversationsAction() {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { error: "Not authenticated", conversations: [] };
        }

        const conversationsRef = db.collection(COLLECTIONS.CONVERSATIONS);
        const snapshot = await conversationsRef
            .where("participants", "array-contains", session.user.id)
            .orderBy("updatedAt", "desc")
            .limit(50)
            .get();

        const conversations = serializeDocs(snapshot.docs) as unknown as Conversation[];

        return { conversations, error: null };
    } catch (error) {
        logger.error("Get conversations error", error);
        return { error: "Failed to load conversations", conversations: [] };
    }
}

/**
 * Admin-only: Get ALL conversations across all users
 * Used by the admin support inbox at /admin/messages
 */
export async function getAllConversationsAdminAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { error: "Not authenticated", conversations: [] };
        }

        // Verify caller is admin
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const roles: string[] = userDoc.data()?.roles ?? [];
        const isAdmin = roles.some(r => r === "admin" || r === "super_admin" || r.endsWith("_admin"));
        if (!isAdmin) {
            return { error: "Access denied", conversations: [] };
        }

        const snapshot = await db.collection(COLLECTIONS.CONVERSATIONS)
            .orderBy("updatedAt", "desc")
            .limit(200)
            .get();

        const conversations = serializeDocs(snapshot.docs) as unknown as Conversation[];

        return { conversations, error: null };
    } catch (error) {
        logger.error("Get all conversations (admin) error", error);
        return { error: "Failed to load conversations", conversations: [] };
    }
}

/**
 * Get messages for a specific conversation
 */
export async function getMessagesAction(conversationId: string, limit = 50) {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { error: "Not authenticated", messages: [] };
        }

        // Verify user is participant OR is admin
        const conversationDoc = await db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId).get();
        if (!conversationDoc.exists) {
            return { error: "Conversation not found", messages: [] };
        }

        const conversation = conversationDoc.data() as Conversation;
        const isParticipant = conversation.participants.includes(session.user.id);

        if (!isParticipant) {
            // Check if admin
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const roles: string[] = userDoc.data()?.roles ?? [];
            const isAdmin = roles.some(r => r === "admin" || r === "super_admin" || r.endsWith("_admin"));
            if (!isAdmin) {
                return { error: "Access denied", messages: [] };
            }
        }

        // Get messages
        const messagesRef = conversationDoc.ref.collection(COLLECTIONS.MESSAGES);
        const snapshot = await messagesRef
            .orderBy("timestamp", "asc")
            .limit(limit)
            .get();

        const messages = serializeDocs(snapshot.docs) as unknown as Message[];

        return { messages, error: null };
    } catch (error) {
        logger.error("Get messages error", error);
        return { error: "Failed to load messages", messages: [] };
    }
}

/**
 * Send a message in a conversation
 */
export async function sendMessageAction(conversationId: string, text: string) {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { error: "Not authenticated", success: false };
        }

        const trimmedText = text.trim();
        if (!trimmedText) {
            return { error: "Message cannot be empty", success: false };
        }

        // Get conversation
        const conversationRef = db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId);
        const conversationDoc = await conversationRef.get();

        if (!conversationDoc.exists) {
            return { error: "Conversation not found", success: false };
        }

        const conversation = conversationDoc.data() as Conversation;
        const isParticipant = conversation.participants.includes(session.user.id);

        if (!isParticipant) {
            // Allow admins to reply to any conversation (support inbox)
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const roles: string[] = userDoc.data()?.roles ?? [];
            const isAdmin = roles.some(r => r === "admin" || r === "super_admin" || r.endsWith("_admin"));
            if (!isAdmin) {
                return { error: "Access denied", success: false };
            }
        }

        // Add message
        const messageData = {
            senderId: session.user.id,
            senderName: session.user.name || "User",
            senderEmail: session.user.email || "",
            text: trimmedText,
            timestamp: FieldValue.serverTimestamp(),
            read: false,
            type: "text"
        };

        await conversationRef.collection(COLLECTIONS.MESSAGES).add(messageData);

        // Update conversation's lastMessage, updatedAt, and lastMessageAt
        await conversationRef.update({
            lastMessage: {
                text: trimmedText,
                senderId: session.user.id,
                senderName: session.user.name || "Support",
                timestamp: FieldValue.serverTimestamp()
            },
            updatedAt: FieldValue.serverTimestamp(),
            lastMessageAt: FieldValue.serverTimestamp()
        });

        return { success: true, error: null };
    } catch (error) {
        logger.error("Send message error", error);
        return { error: "Failed to send message", success: false };
    }
}

/**
 * Mark messages as read in a conversation
 */
export async function markAsReadAction(conversationId: string) {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { error: "Not authenticated", success: false };
        }

        const conversationRef = db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId);

        // Update lastRead timestamp for this user
        await conversationRef.update({
            [`participantDetails.${session.user.id}.lastRead`]: FieldValue.serverTimestamp()
        });

        return { success: true, error: null };
    } catch (error) {
        logger.error("Mark as read error", error);
        return { error: "Failed to mark as read", success: false };
    }
}

/**
 * Start a new conversation with a user
 */
export async function startConversationAction(participantUid: string, productId?: string, orderId?: string) {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { error: "Not authenticated", conversationId: null };
        }

        if (participantUid === session.user.id) {
            return { error: "Cannot message yourself", conversationId: null };
        }

        // Check if conversation already exists
        const existingSnapshot = await db.collection(COLLECTIONS.CONVERSATIONS)
            .where("participants", "array-contains", session.user.id)
            .get();

        for (const doc of existingSnapshot.docs) {
            const conversation = doc.data() as any;
            if (conversation.participants.includes(participantUid) && conversation.participants.length === 2) {
                // Ensure exact match of chat context to avoid mingling product/order/generic chats
                const hasMatchingProduct = productId ? conversation.productId === productId : !conversation.productId;
                const hasMatchingOrder = orderId ? conversation.orderId === orderId : !conversation.orderId;

                if (hasMatchingProduct && hasMatchingOrder) {
                    return { conversationId: doc.id, error: null };
                }
            }
        }

        // Get participant details
        const participantDoc = await db.collection(COLLECTIONS.USERS).doc(participantUid).get();
        if (!participantDoc.exists) {
            return { error: "User not found", conversationId: null };
        }

        const participant = participantDoc.data();

        // Create new conversation
        const conversationData: any = {
            participants: [session.user.id, participantUid],
            participantDetails: {
                [session.user.id]: {
                    uid: session.user.id,
                    name: session.user.name || "User",
                    email: session.user.email || "",
                    lastRead: null
                },
                [participantUid]: {
                    uid: participantUid,
                    name: participant?.fullName || "User",
                    email: participant?.email || "",
                    lastRead: null
                }
            },
            lastMessage: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };

        if (productId) conversationData.productId = productId;
        if (orderId) conversationData.orderId = orderId;

        const newConversation = await db.collection(COLLECTIONS.CONVERSATIONS).add(conversationData);

        return { conversationId: newConversation.id, error: null };
    } catch (error) {
        logger.error("Start conversation error", error);
        return { error: "Failed to start conversation", conversationId: null };
    }
}

/**
 * Search for users to start a conversation with
 */
export async function searchUsersAction(query: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { error: "Not authenticated", users: [] };
        }

        const trimmedQuery = query.trim().toLowerCase();

        const ADMIN_ROLES = ["admin", "super_admin", "wave_admin", "cooperative_admin", "marketplace_admin", "export_admin", "farmnation_admin", "academy_admin"];

        // Determine user's modules to filter admins
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userRoles: string[] = userDoc.data()?.roles ?? [];
        const userIsAdmin = userRoles.some(r => r === "admin" || r === "super_admin" || r.endsWith("_admin"));

        // Mapping of user roles to module keywords found in admin emails
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

        // If no query, return filtered administrators
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
                    // Admins see all other admins
                    if (userIsAdmin) return true;
                    
                    // Always show global/super admins
                    const email = admin.email.toLowerCase();
                    if (email.includes("super") || email.includes("admin.easysalesexport")) return true;

                    // Show module-specific admins if they match the user's modules
                    return userModuleKeywords.some(keyword => email.includes(keyword));
                });

            return { users: admins, error: null };
        }

        // Generic search: pull admins first and apply filtering
        let adminsSnapshot: any;
        let generalSnapshot: any;
        let exactEmailSnapshot: any;

        try {
            [adminsSnapshot, generalSnapshot, exactEmailSnapshot] = await Promise.all([
                db.collection(COLLECTIONS.USERS).where("roles", "array-contains-any", ADMIN_ROLES).get(),
                db.collection(COLLECTIONS.USERS).orderBy("lastLoginAt", "desc").limit(500).get(),
                // Add exact email lookup for the query string
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

        const processDoc = (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
            if (seenIds.has(doc.id)) return;
            const userData = doc.data();
            const fullName = (userData.fullName || "").toLowerCase();
            const email = (userData.email || "").toLowerCase();
            const roles = userData.roles || [];

            // Filter admins during search too
            const isAdmin = roles.some((r: string) => ADMIN_ROLES.includes(r));
            if (isAdmin && !userIsAdmin) {
                const isGlobal = email.includes("super") || email.includes("admin.easysalesexport");
                const matchesModule = userModuleKeywords.some(keyword => email.includes(keyword));
                if (!isGlobal && !matchesModule) return;
            }

            const matches = fullName.includes(trimmedQuery.toLowerCase()) || email.includes(trimmedQuery.toLowerCase());
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

        // Priority 1: Exact email match
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
export async function startSupportConversationAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { error: "Not authenticated", conversationId: null };
        }

        // Get user roles to find the right admin
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

        // Find admins
        const adminSnapshot = await db.collection(COLLECTIONS.USERS)
            .where("roles", "array-contains-any", ["admin", "super_admin", "wave_admin", "cooperative_admin", "marketplace_admin", "export_admin", "farmnation_admin", "academy_admin"])
            .get();

        if (adminSnapshot.empty) {
            return { error: "No admin available currently", conversationId: null };
        }

        // Pick the best admin for the user
        let targetAdmin = adminSnapshot.docs.find(doc => {
            const email = (doc.data().email || "").toLowerCase();
            return userModuleKeywords.some(keyword => email.includes(keyword));
        });

        // Fallback to global admin if no module admin found
        if (!targetAdmin) {
            targetAdmin = adminSnapshot.docs.find(doc => {
                const email = (doc.data().email || "").toLowerCase();
                return email.includes("super") || email.includes("admin.easysalesexport");
            });
        }

        // Final fallback to the first available admin
        if (!targetAdmin) {
            targetAdmin = adminSnapshot.docs[0];
        }

        const adminUid = targetAdmin.id;

        // If user is admin themselves, prevent messaging themselves
        if (adminUid === session.user.id) {
            return { error: "You are an admin", conversationId: null };
        }

        return await startConversationAction(adminUid);
    } catch (error) {
        logger.error("Start support conversation error", error);
        return { error: "Failed to start support conversation", conversationId: null };
    }
}
