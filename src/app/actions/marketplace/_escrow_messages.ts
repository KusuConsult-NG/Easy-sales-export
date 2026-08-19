"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import type { EscrowTransaction, Message } from "@/lib/types/marketplace-escrow";
import { pickOrderEscrow } from "@/lib/escrow-status";

/**
 * Who, other than the two parties, may see an escrow — ONE definition.
 *
 * THE DEFECT
 * ----------
 * This file asked the question two different ways.
 *
 *   sendEscrowMessageAction        isAdmin() — TRUE FOR ALL TEN ADMIN ROLES
 *   getEscrowMessagesAction        isAdmin() — likewise
 *
 *   getEscrowTransactionByIdAction        admin | super_admin | marketplace_admin
 *   getEscrowTransactionByOrderIdAction   admin | super_admin | marketplace_admin
 *
 * So an academy_admin, a wave_admin, an export_admin, a farm_nation_admin, a
 * cooperative_admin, a support agent or a moderator could read a buyer-seller
 * escrow conversation and POST INTO IT — while being refused the escrow record
 * that same conversation hangs off. The permissive pair was the one that
 * writes, and the message it writes reaches another human's screen.
 *
 * Settled on what the two stricter siblings already did, so nothing that works
 * today changes and the loose pair narrows to match. The marketplace's own
 * admin belongs here; the other module admins do not.
 */
const ESCROW_OVERSEER_ROLES = ["admin", "super_admin", "marketplace_admin"] as const;

function canOverseeEscrow(roles: string[] | undefined): boolean {
    return Array.isArray(roles) && roles.some((r) => (ESCROW_OVERSEER_ROLES as readonly string[]).includes(r));
}

/**
 * Send message in escrow chat.
 * Validates both sender session and that they are a participant of the escrow.
 */
async function _sendEscrowMessageAction(data: { escrowId: string;
    senderId: string;
    senderName: string;
    message: string; }): Promise<{ success: true; error: null; data: { message: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: (sessionResult.error as any)?.error ?? "Session expired"};
        }
        const { session } = sessionResult;
        // Verify the caller is actually the stated sender
        if (session.user.id !== data.senderId) { return { success: false as const, error: "Unauthorized"};
        }

        const escrowDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(data.escrowId).get();
        if (!escrowDoc.exists) { return { success: false as const, error: "Escrow transaction not found"};
        }
        const escrow = escrowDoc.data() as EscrowTransaction;

        const isAdminUser = canOverseeEscrow(session.user.roles);
        if (escrow.buyerId !== data.senderId && escrow.sellerId !== data.senderId && !isAdminUser) {
            return { success: false as const, error: "Not a participant of this escrow"};
        }

        // Fields listed, not spread.
        //
        // `data` is whatever JSON arrived at this server action — the declared
        // parameter type is erased at runtime — so `{ ...data, ... }` wrote every
        // key a caller invented into the message document, on top of the four
        // this function means to store.
        //
        // senderName is also DERIVED now rather than accepted. It was the one
        // caller-supplied string that reaches another human's screen: the chat
        // renders `message.senderName` verbatim, so a participant could post as
        // "EasySales Support" while senderId — which nothing renders — correctly
        // recorded them. The client already sent exactly this value
        // (escrow/[id]/chat/page.tsx), so nothing changes for honest callers.
        const senderName = session.user.name || session.user.email || "Unknown";

        const messageData: Omit<Message, "id"> & { createdAt: any } = {
            escrowId: data.escrowId,
            senderId: data.senderId,
            senderName,
            message: data.message,
            timestamp: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            read: false };

        await db.collection(COLLECTIONS.ESCROW_MESSAGES).add(messageData);

        return { error: null, success: true as const, data: { message: "Message sent" } };
    } catch (error) { logger.error("Message send error:", {
            escrowId: data.escrowId,
            senderId: data.senderId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to send message"};
    }
}


export async function sendEscrowMessageAction(data: Parameters<typeof _sendEscrowMessageAction>[0]) {
    return withFlexibleSafeAction("sendEscrowMessageAction", _sendEscrowMessageAction)(data);
}


/**
 * Get escrow messages — only for escrow participants
 */
export async function getEscrowMessagesAction(escrowId: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: "Unauthorized" };
        const { session } = sessionResult;

        // Verify they are a participant or admin
        const escrowDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId).get();
        if (!escrowDoc.exists) return { success: false as const, data: null, error: "Escrow not found" };
        const escrow = escrowDoc.data() as EscrowTransaction;
        const userId = session.user.id;
        const isAdminUser = canOverseeEscrow(session.user.roles);
        if (escrow.buyerId !== userId && escrow.sellerId !== userId && !isAdminUser) {
            logger.warn(`[getEscrowMessages] Non-participant access attempt by ${userId} on escrow ${escrowId}`);
            return { success: false as const, data: null, error: "Access denied" };
        }

        const snapshot = await db.collection(COLLECTIONS.ESCROW_MESSAGES)
            .where("escrowId", "==", escrowId)
            .orderBy("createdAt", "asc")
            .get();

        const messages = serializeDocs(snapshot.docs) as unknown as Message[];
        return { error: null, success: true as const, data: messages };
    } catch (error) { logger.error("Failed to fetch messages:", error);
        return { success: false as const, data: null, error: "Failed to fetch messages" };
    }
}


/**
 * Get single escrow transaction by ID — only for participants or admins
 */
export async function getEscrowTransactionByIdAction(escrowId: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: (sessionResult.error as any)?.error ?? "Session expired", data: null };
        }
        const { session } = sessionResult;

        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);
        const escrowDoc = await escrowRef.get();

        if (!escrowDoc.exists) { return { success: false as const, error: "Escrow transaction not found", data: null };
        }

        const data = escrowDoc.data() as EscrowTransaction;
        const userId = session.user.id;
        const isAdminUser = canOverseeEscrow(session.user.roles);

        if (!isAdminUser && data.buyerId !== userId && data.sellerId !== userId) { return { success: false as const, error: "Not authorized to view this escrow", data: null };
        }

        return { error: null, success: true as const, data: serializeDoc(escrowDoc.id, data) };
    } catch (error) { logger.error("Error fetching escrow transaction:", error);
        return { success: false as const, error: "Failed to fetch escrow transaction", data: null };
    }
}


/**
 * Get single escrow transaction by order ID — only for participants or admins
 */
export async function getEscrowTransactionByOrderIdAction(orderId: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: (sessionResult.error as any)?.error ?? "Session expired", data: null };
        }
        const { session } = sessionResult;

        const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("orderId", "==", orderId)
            // Not `.limit(1)`. With one row fetched there is nothing for
            // pickOrderEscrow to choose between, and the "pick the active one"
            // fix below would be decorative — the single row would still be
            // whichever the database returned first.
            .limit(10)
            .get();

        if (escrowQuery.empty) {
            return { success: false as const, error: "Escrow transaction not found", data: null };
        }

        // The active escrow for this order.
        //
        // The query is `.limit(1)` with no ordering, so this returned an
        // arbitrary row when an order had several — and the participant check
        // below then ran against THAT row rather than the live one.
        const escrowDoc = pickOrderEscrow(escrowQuery.docs);
        if (!escrowDoc) {
            return { success: false as const, error: "Escrow transaction not found", data: null };
        }
        const data = escrowDoc.data() as EscrowTransaction;
        const userId = session.user.id;
        const isAdminUser = canOverseeEscrow(session.user.roles);

        if (!isAdminUser && data.buyerId !== userId && data.sellerId !== userId) {
            return { success: false as const, error: "Not authorized to view this escrow", data: null };
        }

        return { error: null, success: true as const, data: serializeDoc(escrowDoc.id, data) };
    } catch (error) {
        logger.error("Error fetching escrow transaction by order ID:", error);
        return { success: false as const, error: "Failed to fetch escrow transaction", data: null };
    }
}
