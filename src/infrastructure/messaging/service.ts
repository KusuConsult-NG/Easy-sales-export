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
import { isAdmin } from "@/lib/admin-permissions";
import { mayAccessConversation } from "@/lib/conversation-scope";

/**
 *   #635 THE RULE THE LIST AND THE OPENER SHARE — and this time they share it.
 *
 *   This function and getAllConversationsAdmin's filter each wrote out six
 *   module branches by hand, and they had drifted: the list carried a seventh
 *   branch matching a module keyword inside a PARTICIPANT'S EMAIL ADDRESS, and
 *   this one did not. So every direct member-to-member conversation — they are
 *   all contextless — was listed to a module admin whose keyword appeared in
 *   somebody's address, complete with both names and the last message's text,
 *   and then refused when they clicked it.
 *
 *   Both now ask mayAccessConversation in lib/conversation-scope, where the
 *   whole finding is written up.
 */
function validateConversationAccess(conversation: Conversation, userId: string, roles: string[]): boolean {
    return mayAccessConversation(conversation, userId, roles);
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
export async function getAllConversationsAdmin(userId: string, roles: string[]) {
    /**
     *   #356 THIS REFUSED moderator AND support, THE TWO ROLES WHOSE JOB THIS
     *        SCREEN IS.
     *
     *        The test was `r === "admin" || r === "super_admin" ||
     *        r.endsWith("_admin")` — one of six hand-written copies, of which
     *        #353 fixed only hub-guard's. Neither `moderator` nor `support`
     *        matches it, and both are admin roles by the only definition this
     *        codebase has, so a support account asking for the conversation
     *        list got "Access denied" from the support inbox.
     */
    if (!isAdmin(roles)) {
        throw new Error("Access denied: Admin privileges required");
    }

    const snapshot = await db.collection(COLLECTIONS.CONVERSATIONS)
        .orderBy("updatedAt", "desc")
        .limit(200)
        .get();

    const allConversations = serializeDocs(snapshot.docs) as unknown as Conversation[];

    /*
     *   #635 THE SAME QUESTION THE THREAD VIEW ASKS, rather than a second copy
     *   of it. This filter used to restate the six module branches and add a
     *   seventh of its own — a module keyword matched inside a participant's
     *   email address — so it listed conversations that could not be opened,
     *   and listed private member-to-member threads to a module admin on the
     *   strength of a substring. lib/conversation-scope has the write-up.
     *
     *   Taking `userId` is part of the repair: the list is the inbox, and a
     *   conversation this admin is personally a participant of belongs in it
     *   whatever its context.
     */
    return allConversations.filter(c => mayAccessConversation(c, userId, roles));
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

    /*
     *   #870 AND THE PERSON IT WAS SENT TO IS TOLD.
     *
     *   THE OWNER: "in-app messages are not delivered, meaning they are not
     *   properly wired."
     *
     *   Measured, and the report is exact. Everything above writes: the message
     *   row, and `lastMessage` / `lastMessageAt` on the conversation. NOTHING
     *   notified the recipient — no bell, no email — so a message arrived only
     *   if the other party happened to open the Messages screen and look. A
     *   member writing to support, and an admin answering them, were both
     *   shouting into a room nobody was in.
     *
     *   The same defect this audit found in Farm Nation (#862, #863, #864): a
     *   thing happens and the person it happened to is not told.
     *
     *   EVERY OTHER PARTICIPANT, not "the other one". A conversation is an array
     *   of participants; assuming two would work today and silently notify one
     *   of three the moment a thread has more.
     *
     *   NEVER THROWS. The message is already written by the time this runs, so a
     *   failed notice must not turn a delivered message into an error the sender
     *   retries — which would post it twice.
     */
    await notifyOtherParticipants(conversation, conversationId, userId, userName, trimmedText);

    return { success: true };
}

/**
 * Ring the bell for everyone in the thread except the sender. Never throws.
 */
async function notifyOtherParticipants(
    conversation: Conversation,
    conversationId: string,
    senderId: string,
    senderName: string,
    text: string,
): Promise<void> {
    const others = Array.isArray(conversation.participants)
        ? conversation.participants.filter((id) => id && id !== senderId)
        : [];

    if (others.length === 0) return;

    //   A preview, not the message. The bell renders in a narrow row and the
    //   whole point is to get the person to open the thread.
    const preview = text.length > 90 ? `${text.slice(0, 90)}…` : text;

    await Promise.allSettled(others.map(async (recipientId) => {
        try {
            const { createNotification } = await import("@/infrastructure/notifications/service");
            const result = await createNotification({
                userId: recipientId,
                //   In Notification["type"], and what FILTER_TAB_TYPES files
                //   under "All" — there is no messages tab, and inventing a type
                //   no tab names would hide the row rather than surface it.
                type: "info",
                title: `New message from ${senderName || "a member"}`,
                message: preview,
                link: `/messages?c=${conversationId}`,
                linkText: "Open conversation",
            } as never);

            //   #394's rule: this RETURNS its failures rather than throwing, so
            //   an unread result is an invisible one.
            if (!result?.success) {
                logger.error("[messaging] could not notify a participant", {
                    conversationId, recipientId, error: result?.error,
                });
            }
        } catch (error) {
            logger.error("[messaging] notifying a participant threw", {
                conversationId, recipientId, error,
            });
        }
    }));
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
