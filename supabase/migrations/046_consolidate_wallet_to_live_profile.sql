-- Migration: 046_consolidate_wallet_to_live_profile.sql
--
-- Moves a wallet balance from a superseded profile to the live one, in ONE
-- transaction, and refuses to do it for any two profiles the platform does not
-- already say are the same person.
--
-- WHY THIS HAS TO BE A DATABASE FUNCTION
-- --------------------------------------
-- The wallet keying work established that money moves at the LIVE id and
-- nowhere else: credit_wallet_once inserts at p_user_id, debit_wallet_once
-- updates WHERE id = p_user_id, and p_user_id is the session's id, which is
-- live by construction (#490 ranks a superseded row last at login). So a
-- balance left under a superseded profile cannot be received into, cannot be
-- spent from, and cannot be withdrawn. It is stranded.
--
-- The obvious repair is a credit on the live wallet and a debit on the old
-- one. Both of those already exist and both are idempotent by reference — and
-- doing it that way would still be wrong, because THE PAIR IS NOT ATOMIC. Two
-- separate RPC calls, and a crash, a timeout or a deploy between them leaves
-- the credit applied without its debit. That does not lose money; it MINTS it,
-- which is the one failure a platform cannot walk back.
--
-- One function, one transaction, both sides or neither.
--
-- AND IT CARRIES ITS OWN AUTHORISATION
-- ------------------------------------
-- The check that two ids are one person is not left to the caller. An admin
-- action can be wrong, can be called from somewhere new, or can be replaced by
-- a script six months from now; a function that moves money between arbitrary
-- ids on request is a transfer primitive, and this must never be one.
--
-- So the pointer is re-read here, from users, inside the same transaction as
-- the move:
--
--     the source must point AT the target   `_migratedTo` or `supabaseAuthId`
--     the target must itself be live        no `_migratedTo` of its own
--
-- Both are the platform's existing statement that two rows are one person —
-- the same pointer resolveActiveUser walks (#449), the login honours (#490)
-- and the duplicate tool writes (#724). Nothing new is being asserted about
-- anybody; this only ACTS on what is already recorded.
--
-- BOTH COPIES OF THE BALANCE, AS 011 ESTABLISHED
-- ----------------------------------------------
-- A wallet carries its balance twice — wallets.balance and
-- wallets.raw_data->>'balance' — and the application reads raw_data. 011
-- corrected 005/006 for exactly this and every write here follows it: both
-- places written, both derived from raw_data, so a wallet whose copies have
-- already drifted converges on the value the member has been shown.
--
-- IDEMPOTENT BY CONSTRUCTION, NOT BY KEY
-- --------------------------------------
-- The source is set to zero, so a second call finds nothing to move and says
-- so. Two concurrent calls serialise on the row locks and the loser no-ops.
-- That is a stronger guarantee than a reference key, which can only tell you
-- that THIS request already ran.
--
-- SAFE TO APPLY
--   Creates one function. No table, column, row or existing function is
--   touched. Applying it moves nothing — it is only callable deliberately.
--
-- MEASURED BEFORE WRITING IT
--   765 superseded profiles, 272 carrying a wallet row, every one at 0. There
--   is nothing to consolidate today. This exists so that the day there is,
--   the answer is not hand-written SQL against production.

-- ── WHY THIS FUNCTION CONTAINS NO `SELECT … INTO` ───────────────────────────
--
-- REPRODUCED, at last, with the evidence in hand. Pasted into the Supabase SQL
-- Editor this file failed twice, and the second failure named its own cause:
--
--     ERROR: 42601: unterminated dollar-quoted string at or near "$fn$"
--     LINE 16: AS $fn$
--
-- and the editor had APPENDED this to the statement it ran:
--
--     -- Added by Supabase: enable Row Level Security on newly created tables
--     ALTER TABLE v_pointer     ENABLE ROW LEVEL SECURITY;
--     ALTER TABLE v_target_row  ENABLE ROW LEVEL SECURITY;
--     ALTER TABLE v_from_balance ENABLE ROW LEVEL SECURITY;
--     ALTER TABLE v_to_balance  ENABLE ROW LEVEL SECURITY;
--
-- Those four names are not tables. They are the four DECLARE variables this
-- function used to read into, and they are named because in PLAIN SQL —
-- outside a plpgsql body — `SELECT … INTO name FROM …` IS `CREATE TABLE AS`:
--
--     SELECT 2 AS y INTO v_pointer;   -- creates a table called v_pointer
--
-- Verified on PostgreSQL 16, one line, in this repository's own local cluster.
--
-- So the editor parses the function BODY as top-level SQL, finds four table
-- creations that were never there, truncates the statement it is building in
-- order to append its RLS block — and the body is cut off mid-function, which
-- is what leaves `$fn$` unterminated. The earlier failure in this same file
-- (`syntax error at or near "raw_data"`, reported as `LINE 1` of an indented
-- continuation) is the same cut, landing in a different place.
--
-- THE DOLLAR TAGS WERE NEVER THE CAUSE. They were changed from `$$` to `$fn$`
-- and `$chk$` on the suspicion that they were, and that theory could not be
-- reproduced. It is recorded here as wrong rather than quietly deleted. The
-- named tags are kept because they cost nothing and are strictly safer.
--
-- REMOVING THAT PATTERN WAS NECESSARY AND NOT SUFFICIENT, and the second half
-- is recorded as plainly as the first because the first was already written
-- down here as a cure before it had been tried.
--
-- Every read is now an assignment — `v_x := (SELECT …)` — with existence asked
-- separately via EXISTS, because `:=` does not set FOUND and conflating "no
-- row" with "a row holding NULL" would change two of the refusals below. That
-- removes the RLS injection: there are no invented tables left to name.
--
-- THE EDITOR STILL COULD NOT RUN IT. Pasted again, it failed with
--
--     ERROR: 42601: syntax error at or near "RETURN"
--     LINE 1:  RETURN QUERY SELECT FALSE, … 'no_source_wallet'::TEXT;
--
-- `LINE 1` again, on a line that is not line 1 of anything — another fragment
-- of the body run as a whole statement, cut at a different place. So the
-- editor has a SECOND defect independent of the first: its statement splitter
-- does not respect dollar quoting, and a 200-line plpgsql body offers it
-- roughly fifty semicolons to cut at.
--
-- WHAT IS NOT CLAIMED. Exactly which token it cuts on. Two cuts were observed,
-- in the same region of two different bodies, and that is not enough to name a
-- rule. It is left unexplained rather than guessed at.
--
-- HOW TO APPLY THIS FILE, THEN. Either path is verified against a real
-- PostgreSQL 16 with the sixteen behavioural tests:
--
--   psql, which was never affected and is the path of record:
--
--     psql "$PROD_URL" -f supabase/migrations/046_consolidate_wallet_to_live_profile.sql
--
--   or, for the SQL Editor, the same function with its body written as a
--   standard single-quoted string literal instead of a dollar-quoted block.
--   That is ONE statement containing no statement boundary a splitter can
--   find — and no `$` at all. It is generated from this file rather than kept
--   beside it, because two hand-maintained copies of a money function is the
--   drift this repository keeps filing against:
--
--     python3 - <<'EOF'
--     import re
--     s = open("supabase/migrations/046_consolidate_wallet_to_live_profile.sql").read()
--     s = s[s.index("BEGIN;"):s.index("COMMIT;") + 7]
--     lit = lambda b: "'" + b.replace("'", "''") + "'"
--     for tag, kw in (("fn", "AS "), ("chk", "DO ")):
--         m = re.search(r"%s\$%s\$([\s\S]*?)\$%s\$;" % (kw, tag, tag), s)
--         s = s[:m.start()] + kw + lit(m.group(1)) + ";" + s[m.end():]
--     open("046-paste.sql", "w").write(s)
--     EOF
--
--   MEASURED EQUIVALENT, not assumed: applied to two fresh databases built
--   from schema.sql and every other migration, `md5(prosrc)` for the resulting
--   function is identical, and both pass all sixteen tests.
--
BEGIN;

CREATE OR REPLACE FUNCTION consolidate_wallet_to_live_profile(
    p_from_id TEXT,
    p_to_id   TEXT,
    p_actor   TEXT DEFAULT NULL
)
RETURNS TABLE (
    moved        BOOLEAN,
    amount       NUMERIC,
    from_balance NUMERIC,
    to_balance   NUMERIC,
    reason       TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $fn$
DECLARE
    v_from_balance NUMERIC := 0;
    v_to_balance   NUMERIC := 0;
    v_amount       NUMERIC := 0;
    v_pointer      TEXT;
    v_target_ptr   TEXT;
    v_target_row   BOOLEAN;
    v_source_row   BOOLEAN;
    v_source_wlt   BOOLEAN;
    v_reference    TEXT;
    v_now          TEXT;
BEGIN
    IF p_from_id IS NULL OR p_to_id IS NULL
       OR btrim(p_from_id) = '' OR btrim(p_to_id) = '' THEN
        RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 'missing_id'::TEXT;
        RETURN;
    END IF;

    IF p_from_id = p_to_id THEN
        RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 'same_profile'::TEXT;
        RETURN;
    END IF;

    --   THE AUTHORISATION, RE-READ HERE. See the header: this is what stops the
    --   function being a general transfer primitive, so it is not delegated to
    --   the caller and not taken from an argument.
    v_source_row := EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_from_id);
    v_pointer := (
        SELECT COALESCE(u.raw_data ->> '_migratedTo', u.raw_data ->> 'supabaseAuthId')
          FROM public.users u
         WHERE u.id = p_from_id
    );

    IF NOT v_source_row THEN
        RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 'source_profile_not_found'::TEXT;
        RETURN;
    END IF;

    IF v_pointer IS DISTINCT FROM p_to_id THEN
        --   Deliberately the same answer whether the source points somewhere
        --   ELSE or points nowhere at all. Both mean the platform does not say
        --   these two rows are one person, and the difference between them is
        --   not the caller's business.
        RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 'not_the_same_person'::TEXT;
        RETURN;
    END IF;

    --   And the target must be the END of the chain. Moving a balance onto a
    --   row that is ITSELF superseded stranded it again, one hop along, which
    --   would be this whole defect performed by its own repair.
    v_target_row := EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_to_id);
    v_target_ptr := (
        SELECT u.raw_data ->> '_migratedTo'
          FROM public.users u
         WHERE u.id = p_to_id
    );

    IF NOT COALESCE(v_target_row, FALSE) THEN
        RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 'target_profile_not_found'::TEXT;
        RETURN;
    END IF;

    IF v_target_ptr IS NOT NULL THEN
        RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 'target_is_not_live'::TEXT;
        RETURN;
    END IF;

    --   BOTH ROWS LOCKED, IN ID ORDER. Two consolidations naming the same pair
    --   from opposite directions would deadlock on an arbitrary order; ORDER BY
    --   id gives every caller the same sequence. The target may not exist yet,
    --   which is fine — there is then nothing to lock and nothing to race.
    PERFORM 1 FROM public.wallets w
     WHERE w.id IN (p_from_id, p_to_id)
     ORDER BY w.id
       FOR UPDATE;

    v_source_wlt := EXISTS (SELECT 1 FROM public.wallets w WHERE w.id = p_from_id);
    v_from_balance := (
        SELECT COALESCE((w.raw_data ->> 'balance')::numeric, w.balance, 0)
          FROM public.wallets w
         WHERE w.id = p_from_id
    );

    IF NOT v_source_wlt THEN
        RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 'no_source_wallet'::TEXT;
        RETURN;
    END IF;

    v_to_balance := COALESCE((
        SELECT COALESCE((w.raw_data ->> 'balance')::numeric, w.balance, 0)
          FROM public.wallets w
         WHERE w.id = p_to_id
    ), 0);

    IF v_from_balance <= 0 THEN
        --   The idempotent case, and the ordinary one: all 272 superseded
        --   wallets in production are here. Not an error — there is simply
        --   nothing filed under the old profile to move.
        RETURN QUERY SELECT FALSE, 0::NUMERIC, v_from_balance, v_to_balance, 'nothing_to_move'::TEXT;
        RETURN;
    END IF;

    v_amount    := v_from_balance;
    v_now       := to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    v_reference := 'wallet-consolidation-' || p_from_id || '-'
                   || to_char(NOW() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISSMS');

    -- ── the debit, on the superseded wallet ─────────────────────────────────
    UPDATE public.wallets
       SET balance    = 0,
           raw_data   = jsonb_set(COALESCE(raw_data, '{}'::jsonb),
                                  ARRAY['balance'], to_jsonb(0::numeric), true),
           updated_at = NOW()
     WHERE id = p_from_id;

    -- ── the credit, on the live wallet, created if it has none ──────────────
    INSERT INTO public.wallets (id, balance, raw_data)
    VALUES (
        p_to_id,
        v_amount,
        jsonb_build_object('id', p_to_id, 'userId', p_to_id,
                           'balance', v_amount, 'currency', 'NGN')
    )
    ON CONFLICT (id) DO UPDATE
        SET balance    = COALESCE((wallets.raw_data ->> 'balance')::numeric, wallets.balance, 0) + v_amount,
            raw_data   = jsonb_set(
                             COALESCE(wallets.raw_data, '{}'::jsonb),
                             ARRAY['balance'],
                             to_jsonb(COALESCE((wallets.raw_data ->> 'balance')::numeric, wallets.balance, 0) + v_amount),
                             true
                         ),
            updated_at = NOW()
    RETURNING COALESCE((wallets.raw_data ->> 'balance')::numeric, wallets.balance, 0) INTO v_to_balance;

    /*
     *   AND IT IS RECORDED ON BOTH SIDES.
     *
     *   A balance that changes with no ledger row behind it is indistinguishable
     *   from one that changed by accident, and this is the only path on the
     *   platform that moves money between two wallets rather than in or out of
     *   one. Both rows carry the same reference, so the pair reads as one event.
     *
     *   `consolidation_out` / `consolidation_in` are NEW types, chosen so the
     *   lifetime figures in _getWalletAction are untouched: it counts `funding`,
     *   `purchase` and `withdrawal`, and this is none of them. Calling the
     *   credit "funding" would have added money to the member's Total Funded
     *   that they never funded — it was already counted under the old profile.
     */
    INSERT INTO public.document_collections (id, collection_name, raw_data)
    VALUES (
        v_reference || '-out',
        'wallet_transactions',
        jsonb_build_object(
            'walletId', p_from_id, 'userId', p_from_id,
            'type', 'consolidation_out', 'amount', -v_amount,
            'balanceBefore', v_from_balance, 'balanceAfter', 0,
            'reference', v_reference, 'status', 'completed',
            'description', 'Balance moved to the live profile ' || p_to_id,
            'consolidatedFrom', p_from_id, 'consolidatedTo', p_to_id,
            'actorId', p_actor,
            'createdAt', v_now, 'updatedAt', v_now
        )
    )
    ON CONFLICT (id, collection_name) DO NOTHING;

    INSERT INTO public.document_collections (id, collection_name, raw_data)
    VALUES (
        v_reference || '-in',
        'wallet_transactions',
        jsonb_build_object(
            'walletId', p_to_id, 'userId', p_to_id,
            'type', 'consolidation_in', 'amount', v_amount,
            'balanceBefore', v_to_balance - v_amount, 'balanceAfter', v_to_balance,
            'reference', v_reference, 'status', 'completed',
            'description', 'Balance recovered from the superseded profile ' || p_from_id,
            'consolidatedFrom', p_from_id, 'consolidatedTo', p_to_id,
            'actorId', p_actor,
            'createdAt', v_now, 'updatedAt', v_now
        )
    )
    ON CONFLICT (id, collection_name) DO NOTHING;

    RETURN QUERY SELECT TRUE, v_amount, 0::NUMERIC, v_to_balance, NULL::TEXT;
END;
$fn$;

COMMENT ON FUNCTION consolidate_wallet_to_live_profile(text, text, text) IS
    'Moves a stranded wallet balance from a superseded profile to the live one '
    'in a single transaction, and refuses unless the source already points at '
    'the target via _migratedTo or supabaseAuthId and the target is itself '
    'live. Writes both copies of the balance (011) and a matched pair of '
    'wallet_transactions rows. Idempotent: the source is zeroed, so a second '
    'call reports nothing_to_move.';

/*
 *   Only the service role. This is the shape every money function on this
 *   platform has, and it matters more here: the pointer check makes the
 *   function safe to CALL, not safe to expose — a browser that could reach it
 *   could still enumerate ids looking for a pair that satisfies it.
 */
DO $chk$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        REVOKE ALL ON FUNCTION consolidate_wallet_to_live_profile(text, text, text) FROM PUBLIC;
        EXECUTE 'GRANT EXECUTE ON FUNCTION consolidate_wallet_to_live_profile(text, text, text) TO service_role';
    END IF;
END $chk$;

COMMIT;

-- ── VERIFY, against a database that has it ──────────────────────────────────
--
--   -- Two rows, one person, money under the old one:
--   INSERT INTO users (id, raw_data) VALUES
--     ('t-live', '{"id":"t-live"}'::jsonb),
--     ('t-old',  '{"id":"t-old","_migratedTo":"t-live"}'::jsonb);
--   INSERT INTO wallets (id, balance, raw_data) VALUES
--     ('t-old', 5000, '{"id":"t-old","balance":5000}'::jsonb);
--
--   SELECT * FROM consolidate_wallet_to_live_profile('t-old', 't-live', 'admin');
--   -- moved=t, amount=5000, from_balance=0, to_balance=5000
--
--   SELECT * FROM consolidate_wallet_to_live_profile('t-old', 't-live', 'admin');
--   -- moved=f, reason=nothing_to_move        (idempotent)
--
--   -- A stranger is refused, whatever the balances say:
--   INSERT INTO users (id, raw_data) VALUES ('t-other', '{"id":"t-other"}'::jsonb);
--   SELECT * FROM consolidate_wallet_to_live_profile('t-other', 't-live', 'admin');
--   -- moved=f, reason=not_the_same_person
--
--   DELETE FROM document_collections WHERE collection_name = 'wallet_transactions'
--     AND raw_data->>'consolidatedFrom' IN ('t-old','t-other');
--   DELETE FROM wallets WHERE id IN ('t-old','t-live');
--   DELETE FROM users   WHERE id IN ('t-old','t-live','t-other');
