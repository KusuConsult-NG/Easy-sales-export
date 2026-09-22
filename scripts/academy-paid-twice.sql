-- Learners charged more than once for their Academy place - READ ONLY.
-- No writes, updates or deletes. Returns one table.
--
-- PASTE INTO THE SUPABASE SQL EDITOR AND RUN.
--
-- The statement below is ONE unbroken line-group with no blank line inside it,
-- because the SQL Editor splits on blank lines and hands PostgreSQL a fragment
-- -- which is how an earlier diagnostic came back as "syntax error at or near
-- ... LINE 1". There is a ratchet over this file enforcing the shape.
--
-- -----------------------------------------------------------------------------
--  WHY THIS EXISTS
--
--  Between the deploy of #258 and the deploy of #260 -- roughly 12:12 and
--  14:01 UTC on 2026-09-22 -- the Academy submission gate asked ONE source
--  whether a learner had paid, while the Submit button asked FIVE. A learner
--  whose money was recorded in processed_payments but whose registration flag
--  was never written saw the button go green and was refused by the server,
--  under a message telling them to complete their payment.
--
--  Some of those people will have done exactly what the message said and paid
--  a second time. That is the set this finds.
--
-- -- THE DISTINCTION THAT DECIDES A REFUND -------------------------------------
--
--  TWO ROWS IS NOT TWO CHARGES. A webhook replay writes a second ledger row
--  for one Paystack transaction, and the reference is identical on both. A
--  second CHARGE has its own reference.
--
--  So this counts DISTINCT REFERENCES, not rows, and says which it found.
--  Refunding on a row count would refund money that was never taken twice.
--
-- -- WHY IT GROUPS BY PERSON AND NOT BY userId ---------------------------------
--
--  #888: this platform has accounts split across two profile rows, one keyed
--  by a Supabase UUID and one by the old Firebase UID -- four seen so far,
--  abdullahiyusuf1122@gmail.com most recently, whose rows are
--  3f10ab13-3a02-4471-901e-e5b9a391cd30 and BhJBdlDo2HR0A1UGK9Ap83kFIBE2.
--
--  That is not a detail here, it is the WORST CASE. A learner refused while
--  signed in as one row, who paid again, can have the second charge recorded
--  against the other. Grouped by userId each row holds one payment and nothing
--  looks wrong; grouped by person the double charge appears. Rows are gathered
--  by normalised email, which is the same signal #888 detects a split by, and
--  profile_rows reports how many took part.
--
-- -- WHAT IT CANNOT SETTLE ----------------------------------------------------
--
--  The AMOUNTS are reported from both places they are stored and neither is
--  converted. The native column and raw_data.amount do not agree on units
--  across the ledger's history -- the fabricated E2E rows recorded 5,000,000
--  for a 50,000 naira place -- so a total computed here would be a guess
--  wearing a number's clothes. Check the references against Paystack; that is
--  the record that decides a refund, and the references are listed for it.
--
--  A person appearing here has paid twice for one place. Whether the SECOND
--  charge was caused by this regression is what the window column answers,
--  and only for the rows whose timing says so.
-- -----------------------------------------------------------------------------
with academy_pay as (select p.id as payment_id, coalesce(nullif(p.raw_data->>'userId', ''), p.user_id, '') as payer_id, coalesce(nullif(p.reference, ''), p.raw_data->>'reference', '') as reference, p.amount as amount_column, p.raw_data->>'amount' as amount_raw_data, p.created_at from processed_payments p where coalesce(p.raw_data->>'type', '') = 'academy_registration' and coalesce(p.raw_data->>'status', '') in ('success', 'successful', 'completed', 'paid')),
     payer as (select a.*, coalesce(nullif(lower(btrim(u.email)), ''), 'unknown-person:' || a.payer_id) as person_key, u.email as profile_email from academy_pay a left join users u on u.id = a.payer_id),
     windowed as (select payer.*, (created_at >= timestamptz '2026-09-22 12:12:00+00' and created_at < timestamptz '2026-09-22 14:01:00+00') as inside_regression_window from payer),
     grouped as (select person_key, count(*) as ledger_rows, count(distinct reference) as distinct_references, count(distinct payer_id) as profile_rows, count(*) filter (where inside_regression_window) as charges_in_window, min(created_at) as first_charge, max(created_at) as last_charge, string_agg(distinct coalesce(nullif(profile_email, ''), person_key), ', ') as emails, string_agg(distinct payer_id, ', ') as profile_ids, string_agg(distinct reference, ', ') as references_to_check, string_agg(distinct coalesce(amount_column::text, 'null'), ', ') as amounts_column, string_agg(distinct coalesce(amount_raw_data, 'null'), ', ') as amounts_raw_data from windowed group by person_key)
select case when distinct_references > 1 and charges_in_window > 0 and first_charge < timestamptz '2026-09-22 12:12:00+00' then 'PAID TWICE, SECOND CHARGE INSIDE THE REGRESSION WINDOW - refund candidate' when distinct_references > 1 and charges_in_window > 0 then 'PAID TWICE, BOTH INSIDE THE WINDOW - refund candidate, check Paystack' when distinct_references > 1 then 'PAID TWICE, OUTSIDE THE WINDOW - refund candidate, not caused by this regression' else 'ONE CHARGE RECORDED TWICE - a ledger duplicate, NOT a refund' end as verdict,
       case when profile_rows > 1 then 'SPLIT ACCOUNT - the charges are on different profile rows' else 'one profile row' end as account_shape,
       emails, distinct_references, ledger_rows, profile_rows, charges_in_window, first_charge, last_charge, references_to_check, amounts_column, amounts_raw_data, profile_ids
from grouped where ledger_rows > 1 order by distinct_references desc, charges_in_window desc, last_charge desc;
