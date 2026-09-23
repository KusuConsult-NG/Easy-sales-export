-- WHO THE MODULE GATE WAS LETTING IN ON AN ADDRESS SOMEBODY TYPED.
--
-- Layers 2.7 to 2.10 of checkModuleAccess find an application by the caller's
-- email when no application is filed under their user id, and then GRANT THE
-- MODULE ROLE on it. Two things were wrong with that and this counts both.
--
-- 1. THE ADDRESS WAS NOT ONE ANYBODY AUTHENTICATED AS. `userEmail` is written
--    from session.user.email at submission. The fallbacks were not: `email` on
--    a WAVE application is the OPTIONAL field on the form, and `profile.email`
--    and `personalInfo.email` arrive from an import or an admin edit. An
--    applicant who typed somebody else's address and was approved handed that
--    person the module.
--
-- 2. AN APPLICATION THAT ALREADY BELONGED TO SOMEBODY WAS STILL ADOPTED. The
--    userId check guarded only the backfill write, not the grant.
--
-- THE FIX DROPS THE TYPED QUERY on WAVE, Export and Farm Nation, and refuses an
-- owned application everywhere. Academy has NO `userEmail` field at all, so it
-- keeps the typed query and only stops adopting owned rows.
--
-- WHAT TO READ. "ANOTHER ACCOUNT COULD READ THIS ONE" is the exposure that
-- closes. "LOSES THE EMAIL ROUTE" is the cost: rows reachable only by the typed
-- address, which after this deploys need a userId or userEmail backfilled by an
-- admin instead. Anybody the gate ALREADY healed keeps their access, because
-- the grant it wrote is what the earlier layers read; those are not counted
-- here and do not need to be.
--
-- READ ONLY. No INSERT, UPDATE, DELETE or DDL. It counts rows; it changes
-- nothing. Decide what to do after reading it, not from it.
--
-- ONE STATEMENT, NO BLANK LINES, PLAIN ASCII, ON PURPOSE: the Supabase SQL
-- Editor splits a script on blank lines and submits the fragments separately,
-- which is how an earlier diagnostic came back as "syntax error ... LINE 1".
with app as (select 'wave' as module, dc.id as application_id, nullif(btrim(coalesce(dc.raw_data->>'userId', '')), '') as owner_id, lower(nullif(btrim(coalesce(dc.raw_data->>'userEmail', '')), '')) as authenticated_email, lower(nullif(btrim(coalesce(dc.raw_data->>'email', '')), '')) as typed_email, coalesce(dc.raw_data->>'status', '') as status from document_collections dc where dc.collection_name = 'wave_applications' union all select 'export', dc.id, nullif(btrim(coalesce(dc.raw_data->>'userId', '')), ''), lower(nullif(btrim(coalesce(dc.raw_data->>'userEmail', '')), '')), lower(nullif(btrim(coalesce(dc.raw_data#>>'{profile,email}', '')), '')), coalesce(dc.raw_data->>'status', '') from document_collections dc where dc.collection_name = 'export_applications' union all select 'farm-nation', dc.id, nullif(btrim(coalesce(dc.raw_data->>'userId', '')), ''), lower(nullif(btrim(coalesce(dc.raw_data->>'userEmail', '')), '')), lower(nullif(btrim(coalesce(dc.raw_data#>>'{profile,email}', '')), '')), coalesce(dc.raw_data->>'status', '') from document_collections dc where dc.collection_name = 'farm_nation_applications' union all select 'academy', a.id, nullif(btrim(coalesce(a.user_id::text, a.raw_data->>'userId', '')), ''), null::text, lower(nullif(btrim(coalesce(a.raw_data#>>'{personalInfo,email}', '')), '')), coalesce(a.status::text, a.raw_data->>'status', '') from academy_applications a),
     account as (select distinct on (lower(btrim(coalesce(u.email, u.raw_data->>'email', '')))) lower(btrim(coalesce(u.email, u.raw_data->>'email', ''))) as email, u.id as user_id from users u where btrim(coalesce(u.email, u.raw_data->>'email', '')) <> '' order by 1, u.id),
     matched as (select app.module, app.status, app.owner_id, typed.user_id as typed_user_id, authed.user_id as authenticated_user_id from app left join account typed on typed.email = app.typed_email left join account authed on authed.email = app.authenticated_email)
select m.module,
       case when m.owner_id is not null and ((m.typed_user_id is not null and m.typed_user_id <> m.owner_id) or (m.authenticated_user_id is not null and m.authenticated_user_id <> m.owner_id)) then 'ANOTHER ACCOUNT COULD READ THIS ONE - closed by the fix'
            when m.owner_id is not null then 'OWNED - unaffected'
            when m.authenticated_user_id is not null then 'STILL CLAIMABLE - matched on userEmail'
            when m.module = 'academy' and m.typed_user_id is not null then 'STILL CLAIMABLE - academy keeps the typed route'
            when m.typed_user_id is not null then 'LOSES THE EMAIL ROUTE - typed address only'
            else 'NO ACCOUNT HOLDS EITHER ADDRESS' end as verdict,
       count(*) as applications,
       count(*) filter (where m.status in ('approved', 'active', 'approved_admin')) as approved_or_active
from matched m
group by 1, 2
order by 1, applications desc;
