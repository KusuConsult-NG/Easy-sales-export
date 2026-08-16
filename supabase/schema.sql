-- Supabase Database Schema
-- Auto-generated for Hybrid SQL + JSONB Migration
--
-- THIS FILE MUST STAY RE-RUNNABLE. Every table, index and extension below is
-- already IF NOT EXISTS, but the nine updated_at triggers were plain
-- CREATE TRIGGER, so a second run died on
--
--     ERROR: trigger "update_users_updated_at" for relation "users" already exists
--
-- and, because scripts/local-stack/up.sh runs with ON_ERROR_STOP=1, took the
-- whole local stack down with it — PostgREST and the gateway never started.
-- The only way to bring the stack up was to delete the database and lose
-- whatever was seeded in it. CREATE OR REPLACE TRIGGER (PostgreSQL 14+) makes
-- re-running a no-op. Keep new triggers in that form.

-- Enable JSONB helper functions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS '
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
' LANGUAGE plpgsql;

-- ==========================================
-- 1. Core Users Table
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT, -- Removed UNIQUE since Firestore allowed duplicate legacy account emails
    roles TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    raw_data JSONB DEFAULT '{}'::jsonb
);

CREATE OR REPLACE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 2. Cooperative Members Table
-- ==========================================
CREATE TABLE IF NOT EXISTS cooperative_members (
    id TEXT PRIMARY KEY,
    user_id TEXT, -- Removed foreign key reference to allow orphaned records
    status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    raw_data JSONB DEFAULT '{}'::jsonb
);

CREATE OR REPLACE TRIGGER update_coop_members_updated_at 
    BEFORE UPDATE ON cooperative_members 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 3. Cooperative Loans Table
-- ==========================================
CREATE TABLE IF NOT EXISTS cooperative_loans (
    id TEXT PRIMARY KEY,
    user_id TEXT, -- Removed foreign key reference to allow orphaned records
    amount NUMERIC(15, 2),
    status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    raw_data JSONB DEFAULT '{}'::jsonb
);

CREATE OR REPLACE TRIGGER update_coop_loans_updated_at 
    BEFORE UPDATE ON cooperative_loans 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 4. Transactions Table
-- ==========================================
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT, -- Removed foreign key reference to allow orphaned records
    amount NUMERIC(15, 2),
    type TEXT,
    status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    raw_data JSONB DEFAULT '{}'::jsonb
);

CREATE OR REPLACE TRIGGER update_transactions_updated_at 
    BEFORE UPDATE ON transactions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 5. Processed Payments Table
-- ==========================================
CREATE TABLE IF NOT EXISTS processed_payments (
    id TEXT PRIMARY KEY,
    user_id TEXT, -- Removed foreign key reference to allow orphaned records
    amount NUMERIC(15, 2),
    reference TEXT, -- Removed UNIQUE since Firestore allowed duplicate payment references
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    raw_data JSONB DEFAULT '{}'::jsonb
);

CREATE OR REPLACE TRIGGER update_processed_payments_updated_at 
    BEFORE UPDATE ON processed_payments 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 6. Marketplace Orders Table
-- ==========================================
CREATE TABLE IF NOT EXISTS marketplace_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT, -- Removed foreign key reference to allow orphaned records
    status TEXT,
    total_amount NUMERIC(15, 2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    raw_data JSONB DEFAULT '{}'::jsonb
);

CREATE OR REPLACE TRIGGER update_marketplace_orders_updated_at 
    BEFORE UPDATE ON marketplace_orders 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 7. Wallets Table
-- ==========================================
CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY, -- Removed foreign key reference to allow orphaned records
    balance NUMERIC(15, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    raw_data JSONB DEFAULT '{}'::jsonb
);

CREATE OR REPLACE TRIGGER update_wallets_updated_at 
    BEFORE UPDATE ON wallets 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 8. Academy Applications Table
-- ==========================================
CREATE TABLE IF NOT EXISTS academy_applications (
    id TEXT PRIMARY KEY,
    user_id TEXT, -- Removed foreign key reference to allow orphaned records
    status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    raw_data JSONB DEFAULT '{}'::jsonb
);

CREATE OR REPLACE TRIGGER update_academy_apps_updated_at 
    BEFORE UPDATE ON academy_applications 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 9. General Document Collections Table (Generic Fallback)
-- ==========================================
CREATE TABLE IF NOT EXISTS document_collections (
    id TEXT NOT NULL,
    collection_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    raw_data JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (id, collection_name)
);

CREATE OR REPLACE TRIGGER update_doc_collections_updated_at 
    BEFORE UPDATE ON document_collections 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_coop_members_user_id ON cooperative_members(user_id);
CREATE INDEX IF NOT EXISTS idx_coop_loans_user_id ON cooperative_loans(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_processed_payments_reference ON processed_payments(reference);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_user_id ON marketplace_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_doc_collections_name ON document_collections(collection_name);

-- ==========================================
-- Phase 2 Migration Indexes (2026-07)
-- Required by supabase-db.ts adapter
-- ==========================================

-- Composite PK index for document_collections generic table (critical for .doc(id).get())
CREATE INDEX IF NOT EXISTS idx_doc_collections_id_name ON document_collections(id, collection_name);

-- GIN index on raw_data for fast JSONB field queries across all dedicated tables
CREATE INDEX IF NOT EXISTS idx_users_raw_data ON users USING GIN (raw_data);
CREATE INDEX IF NOT EXISTS idx_coop_members_raw_data ON cooperative_members USING GIN (raw_data);
CREATE INDEX IF NOT EXISTS idx_coop_loans_raw_data ON cooperative_loans USING GIN (raw_data);
CREATE INDEX IF NOT EXISTS idx_transactions_raw_data ON transactions USING GIN (raw_data);
CREATE INDEX IF NOT EXISTS idx_processed_payments_raw_data ON processed_payments USING GIN (raw_data);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_raw_data ON marketplace_orders USING GIN (raw_data);
CREATE INDEX IF NOT EXISTS idx_wallets_raw_data ON wallets USING GIN (raw_data);
CREATE INDEX IF NOT EXISTS idx_academy_apps_raw_data ON academy_applications USING GIN (raw_data);
CREATE INDEX IF NOT EXISTS idx_doc_collections_raw_data ON document_collections USING GIN (raw_data);

-- Timestamp ordering indexes (for createdAt DESC queries on document_collections)
CREATE INDEX IF NOT EXISTS idx_doc_collections_created_at ON document_collections(collection_name, created_at DESC);

-- Cooperative member status (common filter: where membershipStatus == 'active')
CREATE INDEX IF NOT EXISTS idx_coop_members_status ON cooperative_members(status);

-- Academy applications status (common filter)
CREATE INDEX IF NOT EXISTS idx_academy_apps_status ON academy_applications(status);
CREATE INDEX IF NOT EXISTS idx_academy_apps_user_id ON academy_applications(user_id);

-- Marketplace orders status
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_status ON marketplace_orders(status);

-- ==========================================
-- Database Integrity Constraint:
-- Enforce "active" status for members with verified payments
-- ==========================================
-- Prevents a paid-up cooperative member being silently reverted to 'pending'.
--
-- Narrow by design — see supabase/migrations/008_fix_member_status_trigger.sql
-- for why. The earlier version blocked ANY user with ANY payment anywhere on
-- the platform, and fired on INSERT, so anyone who had ever paid for anything
-- could not even apply to the cooperative.
CREATE OR REPLACE FUNCTION enforce_member_active_on_paid()
RETURNS TRIGGER AS $$
BEGIN
    -- Applications begin at 'pending'. Never block an insert.
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    -- Only a genuine downgrade of a paid-up member is in scope.
    IF NEW.status <> 'pending' THEN
        RETURN NEW;
    END IF;

    IF OLD.status IS NULL OR OLD.status NOT IN ('active', 'paid') THEN
        RETURN NEW;
    END IF;

    -- An explicit reason permits the change, and records it: the path for
    -- refunds, reversals and administrative corrections.
    IF COALESCE(NULLIF(TRIM(NEW.raw_data->>'statusChangeReason'), ''), '') <> '' THEN
        RETURN NEW;
    END IF;

    -- Only cooperative contributions count as dues paid. Wallet funding,
    -- marketplace purchases and academy fees do not.
    IF EXISTS (
        SELECT 1
          FROM processed_payments p
         WHERE p.user_id = NEW.user_id
           AND p.raw_data->>'type' = 'contribution'
    ) THEN
        RAISE EXCEPTION
            'Member % has a cooperative contribution on record, so status cannot be set to pending. To reverse a payment or correct an error, set raw_data.statusChangeReason explaining why.',
            NEW.user_id
            USING ERRCODE = 'check_violation',
                  HINT = 'Set statusChangeReason on the update to permit this change.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_enforce_member_active_on_paid
    BEFORE INSERT OR UPDATE ON cooperative_members
    FOR EACH ROW EXECUTE FUNCTION enforce_member_active_on_paid();

