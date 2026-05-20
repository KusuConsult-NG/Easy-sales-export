Created At: 2026-05-20T07:49:52Z
Completed At: 2026-05-20T07:49:53Z
File Path: `file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/actions/marketplace/_actions.ts`
Total Lines: 1573
Total Bytes: 66094
Showing lines 1 to 800
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: /**
2:  * Marketplace Server Actions
3:  * 
4:  * Server-side logic for marketplace operations
5:  */
6: 
7: "use server";
8: 
9: import { auth } from "@/lib/auth";
10: import { requireSession } from "@/lib/session-guard";
11: import { logger } from '@/lib/logger';
12: import { FieldValue, Timestamp, AggregateField } from "firebase-admin/firestore";
13: import { db } from "@/lib/firebase-admin"; // Use Admin DB
14: // import { uploadFileToStorage } from "@/lib/storage-admin";
15: 
16: import { COLLECTIONS } from "@/lib/types/firestore";
17: import type { SellerVerification, Product, CartItem, Order, ProductCategory, DeliveryMethod } from "@/lib/types/marketplace";
18: import { hasRole } from "@/lib/role-utils";
19: import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
20: import { unstable_cache } from "next/cache";
21: import { invalidateUserCache } from "@/lib/cache-invalidation";
22: import { ProductSchema, 
23:     OrderSchema, 
24:     SellerAnalyticsSchema,
25:     MarketplaceOnboardingSchema,
26:     SellerVerificationSchema } from "@/lib/validations/marketplace";
27: import { withSafeAction, ActionResponse } from "@/lib/safe-action";
28: 
29: // ============================================
30: // Check Marketplace Application Status Action
31: // ============================================
32: 
33: async function _checkMarketplaceStatusAction(): Promise<ActionResponse<{ status: string; accountType: string } | null>> { 
34:     let sessionResult;
35:     try {
36:         sessionResult = await requireSess
<truncated 35027 bytes>
ion].filter(Boolean).map(String).join(" ").toLowerCase();
761:                 return searchString.includes(searchLower);
762:             });
763:         }
764: 
765:         return { error: null, success: true as const, data: { products } };
766:     } catch (error) { 
767:         logger.error("Get products error:", {
768:             error: error instanceof Error ? error.message : String(error)
769:         });
770:         return { success: false as const, error: "Failed to fetch products", data: null };
771:     }
772: }
773: export const getMarketplaceProductsAction = withSafeAction("getMarketplaceProductsAction", _getMarketplaceProductsAction);
774: 
775: /**
776:  * Get single product by ID
777:  */
778: async function _getProductByIdAction(productId: string): Promise<ActionResponse<Product>> { 
779:     try {
780:         const doc = await db.collection(COLLECTIONS.PRODUCTS).doc(productId).get();
781:         if (!doc.exists) {
782:             return { success: false as const, error: "Product not found", data: null };
783:         }
784: 
785:         const data = doc.data();
786:         const { serializeValue } = await import("@/lib/firestore-serialize");
787:         const product = serializeValue(ProductSchema.parse({ id: doc.id, ...data })) as Product;
788: 
789:         return { error: null, success: true as const, data: product };
790:     } catch (error) { 
791:         logger.error("Get product by id error:", {
792:             productId,
793:             error: error instanceof Error ? error.message : String(error)
794:         });
795:         return { success: false as const, error: "Failed to fetch product", data: null };
796:     }
797: }
798: export const getProductByIdAction = withSafeAction("getProductByIdAction", _getProductByIdAction);
799: export const getProductAction = getProductByIdAction;
800: 
The above content does NOT show the entire file contents. If you need to view any lines of the file which were not shown to complete your task, call this tool again to view those lines.
