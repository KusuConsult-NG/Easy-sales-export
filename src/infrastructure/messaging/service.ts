/**
 * Centralized Messaging Infrastructure Service
 * 
 * Manages all platform-level chat, P2P conversations, admin-support channels, 
 * and cooperative broadcast threads with strict module context and RBAC guards.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import type { Conversation, Message, UserSearchResult } from "@/lib/types/messages";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { serializeDocs } from "@/lib/firestore-serialize";
import { requireSession } from "@/lib/session-guard";
import { MODULE_ADMIN_ROLE } from "@/lib/admin-permissions";

/**
 * Enforces strict role-based and context-based boundaries on conversations.
 * Ensures module-specific admins can only view conversations related to their domain.
 */
function validateConversationAccess(conversation: Conversation, userId: string, roles: string[]): boolean {
    // 1. Is direct participant?
    if (conversation.participants.includes(userId)) {
        return true;
    }

    // 2. Is super admin or global admin?
    const isGlobalAdmin = roles.some(r => r === "admin" || r === "super_admin");
    if (isGlobalAdmin) {
        return true;
    }

    // 3. Is module-specific admin matching conversation context?
    const hasCoopAdmin = roles.includes("cooperative_admin");
    if (hasCoopAdmin && (conversation.context === "cooperative_broadcast" || conversation.context === "cooperative_support" || conversation.orderId?.startsWith("coop_"))) {
        return true;
    }

    const hasMarketAdmin = roles.includes("marketplace_admin");
    if (hasMarketAdmin && (conversation.context === "marketplace_support" || conversation.productId || conversation.orderId)) {
        return true;
    }

    const hasAcademyAdmin = roles.includes("academy_admin");
    if (hasAcademyAdmin && (conversation.context === "academy_support" || conversation.orderId?.startsWith("academy_"))) {
        return true;
    }

    const hasWaveAdmin = roles.includes("wave_admin");
    if (hasWaveAdmin && (conversation.context === "wave_support" || conversation.orderId?.startsWith("wave_"))) {
        return true;
    }

    const hasExportAdmin = roles.includes("export_admin");
    if (hasExportAdmin && (conversation.context === "export_support" || conversation.orderId?.startsWith("export_"))) {
        return true;
    }

    // `farm_nation_admin`, not "farmnation_admin".
    //
    // The role tested here does not exist. Nothing in the codebase writes it;
    // the role is farm_nation_admin, in the canonical list and in the permission
    // matrix. So a real Farm Nation admin passed the endsWith("_admin") gate in
    // getAllConversationsAdmin, matched none of these module filters, and saw an
    // empty conversation list — and this function refused them every individual
    // conversation for the same reason. See MODULE_ADMIN_ROLE.
    const hasFarmNationAdmin = roles.includes(MODULE_ADMIN_ROLE.farmnation);
    if (hasFarmNationAdmin && (conversation.context === "farmnation_support" || conversation.orderId?.startsWith("farm_"))) {
        return true;
    }

    return false;
}

/**
 * Get all conversations for a user
 */
export async function getConversations(userId: string) {
    const snapshot = await db.collection(COLLECTIONS.CONVERSATIONS)
        .where("participants", "array-contains", userId)
        .orderBy("updatedAt", "desc")
        .limit(50)
        .get();

    return serializeDocs(snapshot.docs) as unknown as Conversation[];
}

/**
 * Admin: Get all conversations
 */
export async function getAllConversationsAdmin(roles: string[]) {
    const isAdmin = roles.some(r => r === "admin" || r === "super_admin" || r.endsWith("_admin"));
    if (!isAdmin) {
        throw new Error("Access denied: Admin privileges required");
    }

    const snapshot = await db.collection(COLLECTIONS.CONVERSATIONS)
        .orderBy("updatedAt", "desc")
        .limit(200)
        .get();

    const allConversations = serializeDocs(snapshot.docs) as unknown as Conversation[];
    
    // Filter out conversations based on module admin boundaries
    return allConversations.filter(c => {
        const isGlobalAdmin = roles.some(r => r === "admin" || r === "super_admin");
        if (isGlobalAdmin) return true;
        
        // Modules matching
        if (roles.includes("cooperative_admin") && (c.context === "cooperative_broadcast" || c.context === "cooperative_support" || c.orderId?.startsWith("coop_"))) return true;
        if (roles.includes("marketplace_admin") && (c.context === "marketplace_support" || c.productId || c.orderId)) return true;
        if (roles.includes("academy_admin") && (c.context === "academy_support" || c.orderId?.startsWith("academy_"))) return true;
        if (roles.includes("wave_admin") && (c.context === "wave_support" || c.orderId?.startsWith("wave_"))) return true;
        if (roles.includes("export_admin") && (c.context === "export_support" || c.orderId?.startsWith("export_"))) return true;
        if (roles.includes(MODULE_ADMIN_ROLE.farmnation) && (c.context === "farmnation_support" || c.orderId?.startsWith("farm_"))) return true;
        
        // Fallback for uncategorized legacy support chats using email keyword matching
        if (!c.context) {
            const details = Object.values(c.participantDetails || {});
            const hasKeywordMatch = details.some(d => {
                const email = (d.email || "").toLowerCase();
                if (roles.includes("wave_admin") && email.includes("wave")) return true;
                if (roles.includes("cooperative_admin") && email.includes("coop")) return true;
                if (roles.includes("academy_admin") && email.includes("academy")) return true;
                if (roles.includes("export_admin") && email.includes("export")) return true;
                return false;
            });

            if (hasKeywordMatch) return true;
        }
        
        return false;
    });
}

/**
 * Get messages for a specific conversation
 */
export async function getMessages(conversationId: string, userId: string, roles: string[], limit = 50) {
    const conversationDoc = await db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId).get();
    if (!conversationDoc.exists) {
        throw new Error("Conversation not found");
    }

    const conversation = conversationDoc.data() as Conversation;
    if (!validateConversationAccess(conversation, userId, roles)) {
        throw new Error("Access denied: Unauthorized to read this conversation thread");
    }

    const snapshot = await conversationDoc.ref.collection(COLLECTIONS.MESSAGES)
        .orderBy("timestamp", "asc")
        .limit(limit)
        .get();

    return serializeDocs(snapshot.docs) as unknown as Message[];
}

/**
 * Send message
 */
export async function sendMessage(conversationId: string, userId: string, userName: string, userEmail: string, roles: string[], text: string) {
    const trimmedText = text.trim();
    if (!trimmedText) {
        throw new Error("Message cannot be empty");
    }

    const conversationRef = db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId);
    const conversationDoc = await conversationRef.get();

    if (!conversationDoc.exists) {
        throw new Error("Conversation not found");
    }

    const conversation = conversationDoc.data() as Conversation;
    if (!validateConversationAccess(conversation, userId, roles)) {
        throw new Error("Access denied: Unauthorized to write to this conversation thread");
    }

    const messageData = {
        senderId: userId,
        senderName: userName || "User",
        senderEmail: userEmail || "",
        text: trimmedText,
        timestamp: FieldValue.serverTimestamp(),
        read: false,
        type: "text"
    };

    await conversationRef.collection(COLLECTIONS.MESSAGES).add(messageData);

    await conversationRef.update({
        lastMessage: {
            text: trimmedText,
            senderId: userId,
            senderName: userName || "Support",
            timestamp: FieldValue.serverTimestamp()
        },
        updatedAt: FieldValue.serverTimestamp(),
        lastMessageAt: FieldValue.serverTimestamp()
    });

    return { success: true };
}

/**
 * Mark as read
 */
export async function markAsRead(conversationId: string, userId: string) {
    const conversationRef = db.collection(COLLECTIONS.CONVERSATIONS).doc(conversationId);

    // THE ONE ENTRY POINT WITH NO ACCESS CHECK.
    //
    // getMessages and sendMessage both call validateConversationAccess before
    // touching the thread. This one took a conversation id and a user id and
    // wrote `participantDetails.<userId>.lastRead` straight onto the document —
    // so any signed-in caller could inject a key into ANY conversation,
    // including threads they are not part of and cannot read.
    //
    // Marking a thread read is something only a PARTICIPANT does. A module
    // admin may read a conversation in their scope, but their read receipt does
    // not belong in the participants' record, so participation is the test here
    // rather than validateConversationAccess.
    const conversationDoc = await conversationRef.get();
    if (!conversationDoc.exists) {
        throw new Error("Conversation not found");
    }

    const conversation = conversationDoc.data() as Conversation;
    if (!Array.isArray(conversation.participants) || !conversation.participants.includes(userId)) {
        throw new Error("Access denied: Unauthorized to mark this conversation read");
    }

    await conversationRef.update({
        [`participantDetails.${userId}.lastRead`]: FieldValue.serverTimestamp()
    });

    return { success: true };
}

/**
 * Start direct/product/order conversation
 */
export async function startConversation(userId: string, userName: string, userEmail: string, participantUid: string, productId?: string, orderId?: string, context?: string) {
    if (participantUid === userId) {
        throw new Error("Cannot message yourself");
    }

    // Check if conversation already exists
    const existingSnapshot = await db.collection(COLLECTIONS.CONVERSATIONS)
        .where("participants", "array-contains", userId)
        .get();

    for (const doc of existingSnapshot.docs) {
        const conversation = doc.data() as any;
        if (conversation.participants.includes(participantUid) && conversation.participants.length === 2) {
            const hasMatchingProduct = productId ? conversation.productId === productId : !conversation.productId;
            const hasMatchingOrder = orderId ? conversation.orderId === orderId : !conversation.orderId;
            const hasMatchingContext = context ? conversation.context === context : !conversation.context;

            if (hasMatchingProduct && hasMatchingOrder && hasMatchingContext) {
                return doc.id;
            }
        }
    }

    // Fetch participant profile
    const participantDoc = await db.collection(COLLECTIONS.USERS).doc(participantUid).get();
    if (!participantDoc.exists) {
        throw new Error("Target user not found");
    }

    const participant = participantDoc.data();

    const conversationData: any = {
        participants: [userId, participantUid],
        participantDetails: {
            [userId]: {
                uid: userId,
                name: userName || "User",
                email: userEmail || "",
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
    if (context) conversationData.context = context;

    const newConversation = await db.collection(COLLECTIONS.CONVERSATIONS).add(conversationData);
    return newConversation.id;
}
