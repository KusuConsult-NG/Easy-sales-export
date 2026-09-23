import "server-only";

/**
 * Every index and function the migrations in this repository create.
 *
 *   THE OWNER: "add the migration check", after a day in which a fix they were
 *   waiting on sat unapplied while the screen it repaired stayed broken.
 *
 *   NOTHING APPLIES THESE MIGRATIONS TO PRODUCTION. Not the Dockerfile, not
 *   deploy-production.yml, not a start script. CI runs them — against a
 *   throwaway cluster scripts/test-migrations.sh creates and destroys — so
 *   every suite is green against a database that has all of them, and the real
 *   one is whatever a human last remembered to paste into the SQL editor.
 *
 *   On the day this was written, two of them had not been: 050 and 051. 051
 *   was the other half of a `count users` fix merged hours earlier, and the
 *   admin dashboard read "Total Users — could not be read" the whole time. The
 *   app half had shipped. Nothing anywhere said the other half had not.
 *
 *   #048's header had already described the shape, about a different
 *   migration: "APPLY IT ON ITS OWN means a human, by hand, once, on each
 *   database. Whether that ever happened is not knowable from this
 *   repository — and 027's header records what the same uncertainty cost the
 *   last time: a migration that could not be applied by the SQL Editor ...
 *   AND IT SAT UNAPPLIED." Three migrations have now written that down. This
 *   is the check that makes it knowable.
 *
 * ── WHY A CONSTANT AND NOT A DIRECTORY READ ─────────────────────────────────
 *
 *   supabase/migrations is not shipped. A Next standalone build carries the
 *   `.next` output and nothing else, so nothing at runtime can read those
 *   files. A constant can rot — which is the same failure one level up — so
 *   lib/testing/migration-objects parses the SQL and a ratchet compares. Add a
 *   migration without listing what it creates and CI says so.
 *
 * ── WHAT IT DELIBERATELY DOES NOT CLAIM ─────────────────────────────────────
 *
 *   That an object EXISTS is not that the migration RAN. A hand-made index of
 *   the same name satisfies this, and a migration that also backfills data —
 *   023, 024, 040, 046 — can have created its objects and done none of its
 *   copying. This answers one question honestly: is the SCHEMA this code was
 *   written against the schema it is running against. The backfills are a
 *   separate question and this does not pretend to cover them.
 */

export interface SchemaObject {
    name: string;
    kind: "index" | "function";
    /** The first migration file that creates it — what to apply if it is missing. */
    migration: string;
}

export const EXPECTED_SCHEMA_OBJECTS: readonly SchemaObject[] = [
    { name: "apply_array_ops", kind: "function", migration: "016_atomic_array_ops.sql" },
    { name: "apply_document_patch", kind: "function", migration: "017_targeted_document_patch.sql" },
    { name: "apply_increments", kind: "function", migration: "010_atomic_increments.sql" },
    { name: "atomic_profile_sync", kind: "function", migration: "003_atomic_profile_sync.sql" },
    { name: "claim_idempotency_key", kind: "function", migration: "019_claim_idempotency_key.sql" },
    { name: "claim_payment_once", kind: "function", migration: "009_claim_payment_once.sql" },
    { name: "claim_single_open_loan_application", kind: "function", migration: "021_single_open_loan_application.sql" },
    { name: "claim_status_transition", kind: "function", migration: "007_status_transition_cas.sql" },
    { name: "claim_status_transition_in", kind: "function", migration: "025_status_transition_dedicated_tables.sql" },
    { name: "claim_versioned_update", kind: "function", migration: "020_floored_debit_and_versioned_cas.sql" },
    { name: "consolidate_wallet_to_live_profile", kind: "function", migration: "046_consolidate_wallet_to_live_profile.sql" },
    { name: "count_module_registrations", kind: "function", migration: "049_count_module_registrations.sql" },
    { name: "count_user_segments", kind: "function", migration: "029_user_segment_counts.sql" },
    { name: "credit_wallet_once", kind: "function", migration: "005_atomic_wallet_operations.sql" },
    { name: "debit_jsonb_balance", kind: "function", migration: "013_debit_jsonb_balance.sql" },
    { name: "debit_jsonb_balance_with_floor", kind: "function", migration: "020_floored_debit_and_versioned_cas.sql" },
    { name: "debit_wallet_locked", kind: "function", migration: "006_wallet_ledger_corrections.sql" },
    { name: "debit_wallet_once", kind: "function", migration: "005_atomic_wallet_operations.sql" },
    { name: "decrement_many_or_fail", kind: "function", migration: "015_bounded_counters.sql" },
    { name: "enforce_member_active_on_paid", kind: "function", migration: "008_fix_member_status_trigger.sql" },
    { name: "find_users_by_normalised_email", kind: "function", migration: "030_find_users_by_normalised_email.sql" },
    { name: "find_users_by_normalised_emails", kind: "function", migration: "031_find_users_by_normalised_emails_batch.sql" },
    { name: "find_users_by_supabase_auth_ids", kind: "function", migration: "033_find_users_by_supabase_auth_id.sql" },
    { name: "increment_within_ceiling", kind: "function", migration: "015_bounded_counters.sql" },
    { name: "is_live_person", kind: "function", migration: "037_user_segments_exclude_tombstones.sql" },
    { name: "jsonb_array_remove", kind: "function", migration: "016_atomic_array_ops.sql" },
    { name: "jsonb_array_union", kind: "function", migration: "016_atomic_array_ops.sql" },
    { name: "jsonb_numeric_or_null", kind: "function", migration: "026_document_patch_mirrors_native_columns.sql" },
    { name: "jsonb_present", kind: "function", migration: "034_user_segment_counts_widened.sql" },
    { name: "jsonb_set_deep", kind: "function", migration: "018_nested_path_creation.sql" },
    { name: "jsonb_text_array_or_null", kind: "function", migration: "026_document_patch_mirrors_native_columns.sql" },
    { name: "jsonb_truthy", kind: "function", migration: "029_user_segment_counts.sql" },
    { name: "merge_raw_data", kind: "function", migration: "002_jsonb_merge_update.sql" },
    { name: "missing_schema_objects", kind: "function", migration: "052_missing_schema_objects.sql" },
    { name: "module_registration_counts", kind: "function", migration: "039_module_registration_counts.sql" },
    { name: "native_column_map", kind: "function", migration: "026_document_patch_mirrors_native_columns.sql" },
    { name: "platform_revenue_totals", kind: "function", migration: "012_platform_metrics.sql" },
    { name: "user_segment", kind: "function", migration: "029_user_segment_counts.sql" },
    { name: "idx_academy_applications_created_at", kind: "index", migration: "027_dedicated_table_created_at_indexes.sql" },
    { name: "idx_cm_membership_status", kind: "index", migration: "022_jsonb_expression_indexes.sql" },
    { name: "idx_cm_user_id", kind: "index", migration: "022_jsonb_expression_indexes.sql" },
    { name: "idx_cooperative_loans_created_at", kind: "index", migration: "027_dedicated_table_created_at_indexes.sql" },
    { name: "idx_cooperative_members_created_at", kind: "index", migration: "027_dedicated_table_created_at_indexes.sql" },
    { name: "idx_dc_collection_buyer", kind: "index", migration: "043_buyer_id_expression_indexes.sql" },
    { name: "idx_dc_collection_email", kind: "index", migration: "050_document_collections_user_email_index.sql" },
    { name: "idx_dc_collection_owner", kind: "index", migration: "041_owner_and_seller_expression_indexes.sql" },
    { name: "idx_dc_collection_seller", kind: "index", migration: "041_owner_and_seller_expression_indexes.sql" },
    { name: "idx_dc_collection_status", kind: "index", migration: "022_jsonb_expression_indexes.sql" },
    { name: "idx_dc_collection_user", kind: "index", migration: "022_jsonb_expression_indexes.sql" },
    { name: "idx_marketplace_orders_created_at", kind: "index", migration: "027_dedicated_table_created_at_indexes.sql" },
    { name: "idx_mo_buyer_id", kind: "index", migration: "022_jsonb_expression_indexes.sql" },
    { name: "idx_mo_payment_reference", kind: "index", migration: "022_jsonb_expression_indexes.sql" },
    { name: "idx_mo_payment_status", kind: "index", migration: "022_jsonb_expression_indexes.sql" },
    { name: "idx_pp_status", kind: "index", migration: "022_jsonb_expression_indexes.sql" },
    { name: "idx_pp_type", kind: "index", migration: "022_jsonb_expression_indexes.sql" },
    { name: "idx_processed_payments_created_at", kind: "index", migration: "027_dedicated_table_created_at_indexes.sql" },
    { name: "idx_transactions_created_at", kind: "index", migration: "027_dedicated_table_created_at_indexes.sql" },
    { name: "idx_users_created_at", kind: "index", migration: "027_dedicated_table_created_at_indexes.sql" },
    { name: "idx_users_email_normalised", kind: "index", migration: "030_find_users_by_normalised_email.sql" },
    { name: "idx_users_email_normalised_col", kind: "index", migration: "032_users_email_normalised_column.sql" },
    { name: "idx_users_first_name", kind: "index", migration: "047_user_search_and_purge_indexes.sql" },
    { name: "idx_users_full_name", kind: "index", migration: "047_user_search_and_purge_indexes.sql" },
    { name: "idx_users_gdpr_purge_due", kind: "index", migration: "047_user_search_and_purge_indexes.sql" },
    { name: "idx_users_last_name", kind: "index", migration: "047_user_search_and_purge_indexes.sql" },
    { name: "idx_users_migrated_to", kind: "index", migration: "042_users_migrated_to_index.sql" },
    { name: "idx_users_phone", kind: "index", migration: "038_users_phone_index.sql" },
    { name: "idx_users_phone_number", kind: "index", migration: "038_users_phone_index.sql" },
    { name: "idx_users_raw_created_at", kind: "index", migration: "051_users_raw_created_at_index.sql" },
    { name: "idx_users_roles", kind: "index", migration: "028_users_roles_index.sql" },
    { name: "idx_users_seller_verification_status", kind: "index", migration: "036_users_seller_verification_status_index.sql" },
    { name: "idx_users_supabase_auth_id", kind: "index", migration: "033_find_users_by_supabase_auth_id.sql" },
    { name: "idx_wallets_created_at", kind: "index", migration: "027_dedicated_table_created_at_indexes.sql" },
] as const;

export const EXPECTED_INDEXES: readonly string[] =
    EXPECTED_SCHEMA_OBJECTS.filter((o) => o.kind === "index").map((o) => o.name);

export const EXPECTED_FUNCTIONS: readonly string[] =
    EXPECTED_SCHEMA_OBJECTS.filter((o) => o.kind === "function").map((o) => o.name);

/** Which migration file to apply for a missing object. */
export function migrationFor(name: string): string | null {
    return EXPECTED_SCHEMA_OBJECTS.find((o) => o.name === name)?.migration ?? null;
}
