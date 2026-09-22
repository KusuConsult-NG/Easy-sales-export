-- ============================================================================
--  WHY DOES EXPORT HUB READ 5 — every export status on both sides, side by side
-- ============================================================================
--
--  THE OWNER, on the module breakdown migration 049 produces:
--      Export Hub 5, Export Onboarding 1 — against 20,435 WAVE, 1,791 Marketplace.
--      "check the export registration statuses"
--
--  The code half is answered and fixed (#911): the legacy sync wrote the
--  APPLICATION's status onto the REGISTER without translating it, so a
--  `pending_review` applicant matched neither the Export Hub count nor the
--  onboarding slice. They had applied and appeared in no figure.
--
--  The DATA half needs this. It cannot be answered by reading code, because
--  #835 already records that the two collections can legitimately disagree.
--
--  HOW TO READ IT
--
--    A. the REGISTER — serviceRegistrations.export.status on the user. This is
--       what every count reads. A row here reading `pending_review`, or any
--       status not in ACTIVE_REGISTRATION_STATUSES, is an applicant no figure
--       includes. That is the population #911 stops creating.
--    B. the DETAILED FORM — export_onboarding_applications. If B is much larger
--       than A, the applications exist and the mirror onto the user was never
--       written, which is what data-recovery.ts exists to repair.
--    C. the ROLE, counted separately: the Export Hub figure is the OR of the
--       register and this.
--
--  READ-ONLY. One statement, no blank lines inside it, plain ASCII — the
--  Supabase SQL Editor splits on blank lines and hands PostgreSQL a fragment.
-- ============================================================================
SELECT 'A. register: serviceRegistrations.export.status' AS source, COALESCE(u.service_regs->'export'->>'status', '(no export registration at all)') AS status, count(*) AS people FROM public.users u GROUP BY 2
UNION ALL
SELECT 'B. detailed form: export_onboarding_applications', COALESCE(d.raw_data->>'status', '(no status on the row)'), count(*) FROM public.document_collections d WHERE d.collection_name = 'export_onboarding_applications' GROUP BY 2
UNION ALL
SELECT 'C. role export_participant', 'held', count(*) FROM public.users u WHERE u.roles @> ARRAY['export_participant']::text[]
ORDER BY 1, 3 DESC;
