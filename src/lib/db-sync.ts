import { DocumentReference } from "@google-cloud/firestore";
import { supabaseAdmin } from "./supabase";

if (!(globalThis as any).__FIRESTORE_SYNC_WRAPPED__) {
    (globalThis as any).__FIRESTORE_SYNC_WRAPPED__ = true;

    const originalSet = DocumentReference.prototype.set;
    const originalUpdate = DocumentReference.prototype.update;
    const originalCreate = DocumentReference.prototype.create;
    const originalDelete = DocumentReference.prototype.delete;

    // Mapping Firestore collections to Supabase tables
    const collectionTableMap: Record<string, string> = {
        users: "users",
        cooperative_members: "cooperative_members",
        cooperative_loans: "cooperative_loans",
        transactions: "transactions",
        processedPayments: "processed_payments",
        marketplaceOrders: "marketplace_orders",
        wallets: "wallets",
        academy_applications: "academy_applications",
    };

    // Helper to format timestamps recursively
    function formatTimestamps(obj: any): any {
        if (obj === null || typeof obj !== "object") return obj;
        if (typeof obj.toDate === "function") {
            return obj.toDate().toISOString();
        }
        if (obj.constructor && obj.constructor.name === "Timestamp") {
            return new Date(obj.seconds * 1000 + (obj.nanoseconds || 0) / 1000000).toISOString();
        }
        if (Array.isArray(obj)) {
            return obj.map(formatTimestamps);
        }
        const newObj: any = {};
        for (const key of Object.keys(obj)) {
            newObj[key] = formatTimestamps(obj[key]);
        }
        return newObj;
    }

    // Helper to merge fields for updates
    function mergeUpdateData(original: any, updatePayload: any): any {
        const merged = { ...original };
        for (const [key, value] of Object.entries(updatePayload)) {
            // Handle Firestore nested field paths (e.g. "profile.completed": true)
            if (key.includes(".")) {
                const parts = key.split(".");
                let current = merged;
                for (let i = 0; i < parts.length - 1; i++) {
                    const part = parts[i];
                    current[part] = current[part] ? { ...current[part] } : {};
                    current = current[part];
                }
                current[parts[parts.length - 1]] = value;
            } else {
                merged[key] = value;
            }
        }
        return merged;
    }

    const syncToSupabase = async (
        path: string,
        data: any,
        action: "create" | "set" | "update" | "delete"
    ) => {
        const segments = path.split("/");
        if (segments.length !== 2) return; // Only sync root collections for now
        const collection = segments[0];
        const docId = segments[1];

        const tableName = collectionTableMap[collection] || "document_collections";

        try {
            if (action === "delete") {
                if (tableName === "document_collections") {
                    await supabaseAdmin
                        .from(tableName)
                        .delete()
                        .eq("id", docId)
                        .eq("collection_name", collection);
                } else {
                    await supabaseAdmin
                        .from(tableName)
                        .delete()
                        .eq("id", docId);
                }
                console.log(`[DB Sync] Successfully synced DELETE for ${path}`);
                return;
            }

            // Sync Writes / Updates
            let finalPayload: any = {};
            
            // Format timestamps for Postgres compatibility
            const formattedData = formatTimestamps(data);

            if (action === "update") {
                // Fetch the existing document to merge fields (Postgres JSONB updates require full replacement of raw_data)
                let existingRaw: any = {};
                if (tableName === "document_collections") {
                    const { data: row } = await supabaseAdmin
                        .from(tableName)
                        .select("raw_data")
                        .eq("id", docId)
                        .eq("collection_name", collection)
                        .maybeSingle();
                    existingRaw = row?.raw_data || {};
                } else {
                    const { data: row } = await supabaseAdmin
                        .from(tableName)
                        .select("raw_data")
                        .eq("id", docId)
                        .maybeSingle();
                    existingRaw = row?.raw_data || {};
                }
                
                finalPayload = mergeUpdateData(existingRaw, formattedData);
            } else {
                // set/create
                finalPayload = formattedData;
            }

            // Prepare row columns depending on the target table
            let dbRow: any = {};
            if (tableName === "users") {
                dbRow = {
                    id: docId,
                    email: finalPayload.email || null,
                    roles: finalPayload.roles || [],
                    raw_data: finalPayload,
                };
            } else if (tableName === "cooperative_members") {
                dbRow = {
                    id: docId,
                    user_id: finalPayload.userId || null,
                    status: finalPayload.status || null,
                    raw_data: finalPayload,
                };
            } else if (tableName === "cooperative_loans") {
                dbRow = {
                    id: docId,
                    user_id: finalPayload.userId || null,
                    amount: finalPayload.amount || null,
                    status: finalPayload.status || null,
                    raw_data: finalPayload,
                };
            } else if (tableName === "transactions") {
                dbRow = {
                    id: docId,
                    user_id: finalPayload.userId || null,
                    amount: finalPayload.amount || null,
                    type: finalPayload.type || null,
                    status: finalPayload.status || null,
                    raw_data: finalPayload,
                };
            } else if (tableName === "processed_payments") {
                dbRow = {
                    id: docId,
                    user_id: finalPayload.userId || null,
                    amount: finalPayload.amount || null,
                    reference: finalPayload.reference || null,
                    raw_data: finalPayload,
                };
            } else if (tableName === "marketplace_orders") {
                dbRow = {
                    id: docId,
                    user_id: finalPayload.userId || null,
                    status: finalPayload.status || null,
                    total_amount: finalPayload.totalAmount || null,
                    raw_data: finalPayload,
                };
            } else if (tableName === "wallets") {
                dbRow = {
                    id: docId,
                    balance: finalPayload.balance || 0.00,
                    raw_data: finalPayload,
                };
            } else if (tableName === "academy_applications") {
                dbRow = {
                    id: docId,
                    user_id: finalPayload.userId || null,
                    status: finalPayload.status || null,
                    raw_data: finalPayload,
                };
            } else {
                // document_collections (fallback)
                dbRow = {
                    id: docId,
                    collection_name: collection,
                    raw_data: finalPayload,
                };
            }

            // Perform upsert to Supabase
            const { error: upsertError } = await supabaseAdmin
                .from(tableName)
                .upsert(dbRow, { onConflict: tableName === "document_collections" ? "id, collection_name" : "id" });

            if (upsertError) {
                console.error(`[DB Sync] Supabase upsert failed for table [${tableName}]:`, upsertError);
            } else {
                console.log(`[DB Sync] Successfully synced ${action.toUpperCase()} for ${path}`);
            }
        } catch (err) {
            console.error(`[DB Sync] System error during sync for ${path}:`, err);
        }
    };

    // Wrap set
    DocumentReference.prototype.set = function(data: any, options?: any) {
        const result = (originalSet as any).call(this, data, options);
        syncToSupabase(this.path, data, "set").catch(err => {
            console.error(`[DB Sync] Uncaught error syncing set for ${this.path}:`, err);
        });
        return result;
    };

    // Wrap update
    DocumentReference.prototype.update = function(data: any, precondition?: any) {
        const result = (originalUpdate as any).call(this, data, precondition);
        syncToSupabase(this.path, data, "update").catch(err => {
            console.error(`[DB Sync] Uncaught error syncing update for ${this.path}:`, err);
        });
        return result;
    };

    // Wrap create
    DocumentReference.prototype.create = function(data: any) {
        const result = (originalCreate as any).call(this, data);
        syncToSupabase(this.path, data, "create").catch(err => {
            console.error(`[DB Sync] Uncaught error syncing create for ${this.path}:`, err);
        });
        return result;
    };

    // Wrap delete
    DocumentReference.prototype.delete = function(precondition?: any) {
        const result = (originalDelete as any).call(this, precondition);
        syncToSupabase(this.path, null, "delete").catch(err => {
            console.error(`[DB Sync] Uncaught error syncing delete for ${this.path}:`, err);
        });
        return result;
    };

    console.log("[DB Sync] Global Firestore shadow dual-writing proxy registered successfully.");
}
