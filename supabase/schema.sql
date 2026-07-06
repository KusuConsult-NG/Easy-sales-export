-- Supabase Database Schema
-- Auto-generated for Hybrid SQL + JSONB Migration

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

CREATE TRIGGER update_users_updated_at 
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

CREATE TRIGGER update_coop_members_updated_at 
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

CREATE TRIGGER update_coop_loans_updated_at 
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

CREATE TRIGGER update_transactions_updated_at 
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

CREATE TRIGGER update_processed_payments_updated_at 
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

CREATE TRIGGER update_marketplace_orders_updated_at 
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

CREATE TRIGGER update_wallets_updated_at 
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

CREATE TRIGGER update_academy_apps_updated_at 
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

CREATE TRIGGER update_doc_collections_updated_at 
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
