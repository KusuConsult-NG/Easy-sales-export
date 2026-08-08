-- Migration: 008_fix_member_status_trigger.sql
--
-- Narrows enforce_member_active_on_paid, which currently blocks far more than
-- it was meant to.
--
-- WHAT IT DOES TODAY
-- ------------------
--     IF NEW.status = 'pending' THEN
--         IF EXISTS (SELECT 1 FROM processed_payments WHERE user_id = NEW.user_id)
--         THEN RAISE EXCEPTION ...
--
-- on BEFORE INSERT OR UPDATE of cooperative_members. Three problems:
--
-- 1. ANY payment counts. processed_payments holds every payment on the
--    platform — wallet funding, marketplace purchases, academy fees. A user who
--    once topped up their wallet is treated as having paid cooperative dues.
--
-- 2. IT FIRES ON INSERT. A cooperative application starts life as 'pending'.
--    So anyone who has ever paid for anything cannot apply to the cooperative
--    at all — the insert raises, and the user sees a server error.
--
-- 3. NO WAY BACK. A genuine refund, payment reversal or administrative
--    correction has to move a member to 'pending', and there is no path that
--    allows it. Support cannot fix a mistake without dropping the trigger.
--
-- The blast radius is about to grow. Migration 005/006 made debit_wallet_once
-- write a processed_payments row for every marketplace wallet checkout —
-- previously checkout wrote nothing there. Wallet funding already did. So once
-- that code deploys, a larger share of users would be caught by (1) and (2)
-- than are caught today.
--
-- WHAT THE RULE SHOULD BE
-- -----------------------
-- The intent is sound: someone who has paid their cooperative dues should not
-- be silently reverted to pending. Keep that, drop the rest.
--
--   * UPDATE only. Applications must be able to start at 'pending'.
--   * Only a real downgrade — the row was 'active' or 'paid' and is being
--     moved to 'pending'. Rewriting 'pending' over 'pending' is not a downgrade.
--   * Only cooperative money counts: processed_payments rows whose type is
--     'contribution' (what cooperative/_payment.ts writes). A marketplace
--     purchase is not evidence of cooperative dues.
--   * An explicit, recorded override. Setting raw_data.statusChangeReason
--     permits the downgrade, so refunds and corrections have a documented path.
--     The constraint becomes "you must say why", not "you may not".
--
-- SAFE TO APPLY
--   Replaces one function in place. No table, column or row is touched. It
--   only ever loosens what is permitted, so nothing that succeeds today starts
--   failing.

BEGIN;

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

    -- An explicit reason permits the change, and records it. This is the path
    -- for refunds, reversals and administrative corrections.
    IF COALESCE(NULLIF(TRIM(NEW.raw_data->>'statusChangeReason'), ''), '') <> '' THEN
        RETURN NEW;
    END IF;

    -- Only cooperative contributions count as having paid dues. Wallet
    -- funding, marketplace purchases and academy fees are not evidence of
    -- cooperative membership having been paid for.
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

-- Trigger definition unchanged: still BEFORE INSERT OR UPDATE, because the
-- function now decides for itself and returning early on INSERT is cheap.
-- Recreated so applying this file alone is sufficient.
CREATE OR REPLACE TRIGGER trg_enforce_member_active_on_paid
    BEFORE INSERT OR UPDATE ON cooperative_members
    FOR EACH ROW EXECUTE FUNCTION enforce_member_active_on_paid();

COMMIT;

-- ============================================================================
-- VERIFICATION — run on staging.
-- ============================================================================
--
-- Setup: a user with a marketplace payment but no cooperative contribution.
--
--   INSERT INTO processed_payments (id, user_id, amount, reference, raw_data)
--   VALUES ('t-pay-1', 't-user-1', 100, 't-pay-1',
--           '{"type":"wallet_debit","status":"wallet_debit"}'::jsonb);
--
-- 1. They can apply. This used to raise.
--
--   INSERT INTO cooperative_members (id, user_id, status)
--   VALUES ('t-mem-1', 't-user-1', 'pending');
--   -- expect: success
--
-- 2. A marketplace payment does not lock them as active.
--
--   UPDATE cooperative_members SET status = 'active' WHERE id = 't-mem-1';
--   UPDATE cooperative_members SET status = 'pending' WHERE id = 't-mem-1';
--   -- expect: success (no contribution on record)
--
-- 3. A real contribution does protect them.
--
--   INSERT INTO processed_payments (id, user_id, amount, reference, raw_data)
--   VALUES ('t-pay-2', 't-user-1', 5000, 't-pay-2', '{"type":"contribution"}'::jsonb);
--   UPDATE cooperative_members SET status = 'active' WHERE id = 't-mem-1';
--   UPDATE cooperative_members SET status = 'pending' WHERE id = 't-mem-1';
--   -- expect: EXCEPTION
--
-- 4. A refund with a stated reason is allowed.
--
--   UPDATE cooperative_members
--      SET status = 'pending',
--          raw_data = raw_data || '{"statusChangeReason":"Contribution refunded, ref t-pay-2"}'::jsonb
--    WHERE id = 't-mem-1';
--   -- expect: success
--
-- Clean up:
--
--   DELETE FROM cooperative_members WHERE id = 't-mem-1';
--   DELETE FROM processed_payments WHERE id LIKE 't-pay-%';

-- ============================================================================
-- ROLLBACK — restores the original, over-broad rule.
-- ============================================================================
--
-- CREATE OR REPLACE FUNCTION enforce_member_active_on_paid()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     IF NEW.status = 'pending' THEN
--         IF EXISTS (SELECT 1 FROM processed_payments WHERE user_id = NEW.user_id) THEN
--             RAISE EXCEPTION 'Database Integrity Constraint: User % has a verified payment. Status cannot be set to pending.', NEW.user_id;
--         END IF;
--     END IF;
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
