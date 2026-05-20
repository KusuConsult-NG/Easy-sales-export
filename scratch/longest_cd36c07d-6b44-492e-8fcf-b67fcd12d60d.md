Created At: 2026-05-20T07:50:08Z
Completed At: 2026-05-20T07:50:10Z
File Path: `file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/actions/disputes.ts`
Total Lines: 551
Total Bytes: 25836
Showing lines 1 to 551
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: /**
2:  * Server Actions for Dispute Resolution System
3:  */
4: 
5: "use server";
6: 
7: import { requireSession } from "@/lib/session-guard";
8: import { logger } from '@/lib/logger';
9: import { db } from "@/lib/firebase-admin";
10: import { COLLECTIONS } from "@/lib/types/firestore";
11: import type { Dispute, Order, DisputeReason, DisputeResolution } from "@/lib/types/marketplace";
12: import { hasRole } from "@/lib/role-utils";
13: import { FieldValue, Timestamp } from "firebase-admin/firestore";
14: import { withFlexibleSafeAction } from "@/lib/safe-action";
15: import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
16: import { smsDisputeResolved } from "@/lib/termii";
17: import { pushDisputeResolved } from "@/lib/fcm";
18: 
19: 
20: /**
21:  * Create a new dispute for an order
22:  */
23: async function _createDisputeAction(params: { orderId: string;
24:     reason: DisputeReason;
25:     description: string;
26:     evidenceUrls?: string[]; }) { let sessionResult;
27:     try {
28:         sessionResult = await requireSession();
29:         if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
30:         const { session } = sessionResult;
31:         const userId = session.user.id;
32: 
33:         const { orderId, reason, description, evidenceUrls = [] } = params;
34: 
35:         if (description.length < 50) { return { success: false as const, error: "Description must be at least 50 characters", data: null };
36:         }
37: 
38
<truncated 24945 bytes>
8:                 const sellerIdStr = dispute.sellerId;
519:                 const [buyerDoc, sellerDoc] = await Promise.all([
520:                     db.collection(COLLECTIONS.USERS).doc(buyerIdStr).get(),
521:                     db.collection(COLLECTIONS.USERS).doc(sellerIdStr).get(),
522:                 ]);
523:                 const buyerPhone = buyerDoc.data()?.phone ?? buyerDoc.data()?.phoneNumber;
524:                 const sellerPhone = sellerDoc.data()?.phone ?? sellerDoc.data()?.phoneNumber;
525:                 
526:                 await Promise.allSettled([
527:                     buyerPhone ? smsDisputeResolved(buyerPhone, dispute.orderId || disputeId, resolution) : Promise.resolve(),
528:                     sellerPhone ? smsDisputeResolved(sellerPhone, dispute.orderId || disputeId, resolution) : Promise.resolve(),
529:                     pushDisputeResolved(buyerIdStr, sellerIdStr, dispute.orderId || disputeId)
530:                 ]);
531:             }
532:         } catch (notifErr) {
533:             logger.error("Failed to send post-transaction notifications:", notifErr);
534:         }
535: 
536:         // Invalidate Cache
537:         try { await invalidateAdminGlobalStats();
538:         } catch (err) { logger.error("Cache invalidation failed after dispute resolution", err);
539:         }
540: 
541:         return { error: null, success: true as const, data: null };
542:     } catch (error) { logger.error("Update dispute error:", {
543:             disputeId,
544:             userId: sessionResult?.session?.user?.id,
545:             error: error instanceof Error ? error.message : String(error)
546:         });
547:         return { success: false as const, error: error instanceof Error ? error.message : "Failed to update dispute status", data: null };
548:     }
549: }
550: export const updateDisputeStatusAction = withFlexibleSafeAction("updateDisputeStatusAction", _updateDisputeStatusAction);
551: 
The above content shows the entire, complete file contents of the requested file.
