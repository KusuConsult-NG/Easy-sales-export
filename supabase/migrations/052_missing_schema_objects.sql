-- 052 — WHICH OF THIS REPOSITORY'S MIGRATIONS HAVE REACHED THIS DATABASE
--
-- WHY
-- ---
-- Nothing applies these migrations to production. Not the Dockerfile, not
-- deploy-production.yml, not a start script. CI runs them against a throwaway
-- cluster scripts/test-migrations.sh creates and destroys, so every suite is
-- green against a database that has all of them — and the real one is whatever
-- a human last remembered to paste into the SQL editor.
--
-- On the day this was written, 050 and 051 had not been. 051 was the other half
-- of a `count users` fix merged hours earlier, and the admin dashboard read
-- "Total Users — could not be read" the whole time. The app half had shipped.
-- Nothing anywhere said the other half had not.
--
-- 048's header had already described the shape, about a different migration:
-- "APPLY IT ON ITS OWN means a human, by hand, once, on each database. Whether
-- that ever happened is not knowable from this repository." 027 recorded the
-- same thing before it. This makes it knowable.
--
-- WHAT IT DOES
-- ------------
-- Takes the names the application expects and returns only the ones this
-- database does not have. The comparison happens HERE so the answer is small:
-- a healthy database returns no rows.
--
-- THE CHICKEN AND EGG IS DELIBERATE AND IS NOT A PROBLEM. If THIS migration
-- has not been applied either, the function is missing, the caller's RPC fails
-- with PGRST202, and lib/rpc-unavailable classifies it as "missing" — which is
-- the loudest possible answer to the question being asked. The caller reports
-- it by name rather than treating an unreachable check as a clean bill.
--
-- NOT SECURITY DEFINER. It is called with the service role, which can already
-- read these catalogues, and a function that reads schema metadata has no
-- reason to carry privileges of its own.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.missing_schema_objects(
    expected_indexes text[],
    expected_functions text[]
)
RETURNS TABLE (object_name text, object_kind text)
LANGUAGE sql
STABLE
AS $$
    SELECT wanted AS object_name, 'index'::text AS object_kind
      FROM unnest(coalesce(expected_indexes, ARRAY[]::text[])) AS wanted
     WHERE NOT EXISTS (
           SELECT 1 FROM pg_indexes i
            WHERE i.schemaname = 'public' AND i.indexname = wanted)
    UNION ALL
    SELECT wanted AS object_name, 'function'::text AS object_kind
      FROM unnest(coalesce(expected_functions, ARRAY[]::text[])) AS wanted
     WHERE NOT EXISTS (
           SELECT 1 FROM pg_proc p
             JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public' AND p.proname = wanted);
$$;

RESET lock_timeout;
