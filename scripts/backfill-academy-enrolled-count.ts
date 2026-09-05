/**
 * Recount `enrolledCount` on every academy course, from the enrolment rows.
 *
 * Run (report only, writes nothing):   npm run backfill:enrolledcount
 * Run (writes the counts):             npm run backfill:enrolledcount -- --apply
 *
 * WHY IT IS NEEDED
 * ----------------
 * #336 made `enrolledCount` the single enrolment tally and recorded that
 * courses enrolled before that commit hold their PAID enrolments only in
 * `students`, so `enrolledCount` under-counts them until a one-off backfill.
 * This is it.
 *
 * WHY IT RECOUNTS INSTEAD OF ADDING
 * ---------------------------------
 * The obvious repair, `enrolledCount + students`, is wrong. Since #336 the paid
 * path increments BOTH on the same enrolment, so every paid enrolment after
 * that commit would be counted twice, and a counter cannot tell you when it was
 * incremented. Rows can. See scripts/academy-enrolment-tally.ts for the
 * arithmetic and for the second trap — ENROLLMENTS rows exist from checkout
 * INITIATION, at status "pending_payment", so counting rows blindly would add
 * every abandoned checkout.
 *
 * WHY IT IS SAFE TO RE-RUN
 * ------------------------
 * It computes an absolute figure from rows and writes that figure. Running it
 * twice writes the same number. It moves no money, changes no status, and
 * touches nothing but `enrolledCount` and a stamp saying when it last ran.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * Zero a live figure. A recount of 0 against a stored count above 0 is the
 * signature of rows this script could not see — a renamed field, a collection
 * it does not read — and is indistinguishable from everybody un-enrolling. Such
 * courses are REPORTED under REFUSED and left exactly as they are.
 *
 * `students` and `studentsCount` ARE NOT TOUCHED. #336 kept them deliberately,
 * for the same reason #183 kept both `message` and `content`: no row loses a
 * value it already carries.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import {
    tallyEnrolments,
    decideForCourse,
    type EnrolmentRow,
    type CourseDecision,
} from './academy-enrolment-tally';
import { isApply, targetHost, modeBanner, runScript } from './_maintenance-guard';

if (existsSync('.env.development.local')) loadEnv({ path: '.env.development.local' });
loadEnv({ path: '.env.local' });

/**
 * The four things every writing script here shares, taken from the shared
 * guard rather than restated.
 *
 * This script hand-rolled all of them on the first draft, and #329's ratchet
 * caught it — which is the ratchet earning its keep, because one of the four is
 * a genuine safety rule this backfill was missing: NAME THE TARGET DATABASE
 * BEFORE DOING ANYTHING, and refuse when it cannot be named. A repair script
 * that does not say which database it is pointed at is one wrong shell variable
 * away from repairing the wrong one.
 */
const APPLY = isApply();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function fail(msg: string): never {
    console.error(`\n❌ ${msg}\n`);
    process.exit(1);
}

if (!url || !serviceKey) {
    fail('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.');
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

/**
 * The three collections that hold an enrolment (#424's map).
 *
 * academy_enrollments mirrors enrollments under the same id; including it costs
 * nothing because the tally deduplicates on (courseId, userId), and it means a
 * mirror row whose source is missing is still seen.
 */
const ENROLMENT_COLLECTIONS = ['course_enrollments', 'enrollments', 'academy_enrollments'];

/** Every row of one document collection, paged. */
async function readAll(collectionName: string): Promise<Record<string, any>[]> {
    const PAGE = 1000;
    const out: Record<string, any>[] = [];

    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from('document_collections')
            .select('id, raw_data')
            .eq('collection_name', collectionName)
            .range(from, from + PAGE - 1);

        if (error) fail(`Reading ${collectionName}: ${error.message}`);
        if (!data || data.length === 0) break;
        for (const row of data) out.push((row.raw_data ?? {}) as Record<string, any>);
        if (data.length < PAGE) break;
    }
    return out;
}

async function main(): Promise<void> {
    // Names the database before a single row is read, and throws when it
    // cannot — an unknown target must stop the script, not be waved through.
    console.log(modeBanner('Academy enrolledCount backfill', APPLY, targetHost()));

    // 1. Every enrolment row, from every collection that holds one.
    const rows: EnrolmentRow[] = [];
    for (const c of ENROLMENT_COLLECTIONS) {
        const found = await readAll(c);
        console.log(`  ${c.padEnd(22)} ${found.length} row(s)`);
        rows.push(...found as EnrolmentRow[]);
    }

    const { byCourse, excluded } = tallyEnrolments(rows);

    console.log(`\nDistinct learners found on ${byCourse.size} course(s).`);
    if (excluded.size > 0) {
        console.log('\nRows NOT counted (each reported, none assumed):');
        for (const [reason, n] of [...excluded.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`  ${String(n).padStart(6)}  ${reason}`);
        }
    }

    // 2. Every course, and what its stored count says. Read with the id, which
    //    readAll() drops — the id is what the tally is keyed on.
    const { data: courseRows, error: courseErr } = await admin
        .from('document_collections')
        .select('id, raw_data')
        .eq('collection_name', 'academy_courses');
    if (courseErr) fail(`Reading academy_courses: ${courseErr.message}`);

    const updates: { id: string; decision: CourseDecision }[] = [];
    const refused: { id: string; decision: CourseDecision }[] = [];
    let unchanged = 0;

    for (const row of courseRows ?? []) {
        const id = String(row.id);
        const raw = (row.raw_data ?? {}) as Record<string, any>;
        const counted = byCourse.get(id)?.size ?? 0;
        const decision = decideForCourse(raw.enrolledCount, counted);

        if (decision.action === 'unchanged') { unchanged++; continue; }
        if (decision.action === 'refuse') { refused.push({ id, decision }); continue; }
        updates.push({ id, decision });
    }

    console.log(`\nAlready correct:  ${unchanged}`);
    console.log(`To update:        ${updates.length}`);
    console.log(`Refused:          ${refused.length}`);

    if (updates.length) {
        console.log('\nCourses to update:');
        for (const u of updates) {
            const d = u.decision as { stored: number; counted: number };
            const arrow = d.counted > d.stored ? '↑' : '↓';
            console.log(`  ${u.id}  ${d.stored} ${arrow} ${d.counted}`);
        }
    }

    if (refused.length) {
        console.log('\nREFUSED — left exactly as they are:');
        for (const r of refused) {
            const d = r.decision as { stored: number; counted: number; reason: string };
            console.log(`  ${r.id}  stored ${d.stored}, recount ${d.counted} — ${d.reason}`);
        }
    }

    if (!APPLY) {
        console.log('\nNothing was written. Re-run with --apply to write.\n');
        return;
    }

    let done = 0;
    for (const u of updates) {
        const { data, error: readErr } = await admin
            .from('document_collections')
            .select('raw_data')
            .eq('collection_name', 'academy_courses')
            .eq('id', u.id)
            .single();

        if (readErr) { console.error(`  ! ${u.id}: re-read failed — ${readErr.message}`); continue; }

        const merged = {
            ...((data?.raw_data ?? {}) as Record<string, unknown>),
            enrolledCount: (u.decision as { counted: number }).counted,
            enrolledCountRecountedAt: new Date().toISOString(),
        };

        const { error } = await admin
            .from('document_collections')
            .update({ raw_data: merged })
            .eq('collection_name', 'academy_courses')
            .eq('id', u.id);

        if (error) { console.error(`  ! ${u.id}: ${error.message}`); continue; }
        done++;
    }

    console.log(`\n✅ Updated ${done} of ${updates.length} course(s).\n`);
}

runScript('Academy enrolledCount backfill', main);
