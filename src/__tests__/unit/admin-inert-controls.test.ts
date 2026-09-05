/**
 * @jest-environment node
 */

/**
 * Four admin controls that rendered, hovered, and did nothing.
 *
 * The same scan that found five inert buttons across the cooperative pages,
 * pointed at the 75 pages under src/app/admin. Each of the four turned out to
 * be a different kind of not-finished:
 *
 *   export/orders          "Upload Document (Bill of Lading, Invoice)" — no
 *                          handler. Every part of the feature existed and none
 *                          of them were joined up: the server action has always
 *                          accepted an optional `documentData` and arrayUnion'd
 *                          it onto `documents`, the panel renders `documents`
 *                          as {name, url}, and /api/upload stores a file and
 *                          returns exactly that pair. Nothing called any of it,
 *                          so the panel read "No documents uploaded yet" for
 *                          every order, permanently, and the one control
 *                          offered to change that did nothing. WIRED UP.
 *
 *   export/applications    the "View Details" eye had no onClick AND no
 *                          className — it rendered unstyled beside four working
 *                          siblings. The panel it should open already existed.
 *                          Fixing it exposed a second defect: that panel renders
 *                          on `selectedApp` alone while the raw-details modal
 *                          renders on `selectedApp && isRawDetailOpen`, so
 *                          "Full Raw Details" opened BOTH, with the drawer's
 *                          backdrop swallowing the click meant to dismiss the
 *                          modal on top of it. GATED.
 *
 *   academy quiz           "Add Question" opened its menu on CSS :hover alone.
 *                          A touch device has no hover, so on a tablet the
 *                          button did nothing at all — while the empty state two
 *                          elements below reads, in as many words, `Click "Add
 *                          Question" to get started.` Clicking was the one thing
 *                          that did not work. CLICK TOGGLE ADDED, hover kept.
 *
 *   communications/in-app  the notification PREVIEW rendered its link as a
 *                          <button>. Inert is correct here — it is a preview —
 *                          but a <button> takes focus and is announced as
 *                          actionable, so a keyboard or screen-reader user was
 *                          offered a control that does nothing by design.
 *                          Now a <span>.
 *
 * The scan is structural and covers all of src/app/admin, so a fifth cannot
 * slip in behind these.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ORDERS = 'src/app/admin/export/orders/page.tsx';
const APPLICATIONS = 'src/app/admin/export/applications/page.tsx';
const QUIZ = 'src/app/admin/academy/courses/[courseId]/quiz/page.tsx';
const IN_APP = 'src/app/admin/communications/in-app/page.tsx';
const EXPORT_ADMIN = 'src/app/actions/export-admin.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

/** Strip comments, so a control described in prose is not mistaken for one. */
function strip(src: string): string {
    return src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.tsx')) out.push(full);
    }
    return out;
}

interface Inert { file: string; line: number; label: string }

function inertButtons(): Inert[] {
    const found: Inert[] = [];

    for (const file of walk(join(process.cwd(), 'src/app/admin'))) {
        const src = strip(readFileSync(file, 'utf-8'));

        for (const m of src.matchAll(/<button\b((?:[^>]|\n)*?)>/g)) {
            // Inert only if it does nothing AND cannot do anything.
            //
            // `disabled` excuses a control only when it is UNCONDITIONAL — a
            // bare `disabled` or `disabled={true}` is a deliberate placeholder.
            // `disabled={isUploading}` is not: the button is enabled most of
            // the time, and without a handler it does nothing when clicked.
            // Mutation-testing this scan found exactly that gap — stripping the
            // onClick from the upload button left it looking "deliberately
            // disabled" and the scan reported nothing.
            const attrs = m[1];
            if (/onClick|type="submit"/.test(attrs)) continue;
            if (/\bdisabled(\s*=\s*\{true\})?(\s|\/|>|$)/.test(attrs) && !/disabled\s*=\s*\{(?!true\})/.test(attrs)) continue;

            const tail = src.slice(m.index! + m[0].length);
            const label = tail.split('</button>')[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

            found.push({
                file: relative(process.cwd(), file),
                line: src.slice(0, m.index).split('\n').length,
                label: label.slice(0, 60),
            });
        }
    }

    return found;
}

describe('the admin pages', () => {
    it('offer no button that does nothing when clicked', () => {
        // THE test.
        const inert = inertButtons();

        if (inert.length) {
            throw new Error(
                '\n\n⚠️  Inert button(s) under src/app/admin — they render and hover '
                + 'and do nothing:\n\n'
                + inert.map((b) => `  ${b.file}:${b.line}  "${b.label}"`).join('\n')
                + '\n\nGive it a handler, mark it disabled with a reason, or make it a span.\n',
            );
        }

        expect(inert).toEqual([]);
    });

    it('and the scan can find one, so the assertion is not vacuous', () => {
        const src = `
            <button className="x">
                <span>Do Nothing</span>
            </button>
        `;
        const matches = [...strip(src).matchAll(/<button\b((?:[^>]|\n)*?)>/g)]
            .filter((m) => !/onClick|type="submit"|disabled/.test(m[1]));

        expect(matches).toHaveLength(1);
    });

    it('and does not flag one that is wired up', () => {
        const src = `
            <button onClick={go} className="x">A</button>
            <button type="submit">B</button>
            <button disabled>C</button>
        `;
        const matches = [...strip(src).matchAll(/<button\b((?:[^>]|\n)*?)>/g)]
            .filter((m) => !/onClick|type="submit"|disabled/.test(m[1]));

        expect(matches).toHaveLength(0);
    });
});

describe('the export order document upload', () => {
    const page = source(ORDERS);

    it('uploads the file and attaches it to the order', () => {
        // THE test.
        expect(page).toContain('async function handleUploadDocument(file: File)');
        expect(page).toContain('await fetch("/api/upload", { method: "POST", body })');
        expect(page).toContain('{ name: uploaded.filename || file.name, url: uploaded.url, type: file.type }');
    });

    it('through the parameter the server action already had', () => {
        // Vacuity guard, and the reason this is wiring rather than a feature:
        // the server side has always supported it.
        expect(source(EXPORT_ADMIN)).toContain('documentData?: { name: string; url: string; type: string }');
        expect(source(EXPORT_ADMIN)).toContain('updateData.documents = FieldValue.arrayUnion(documentData);');
    });

    it('re-sending the order\'s own status, because it attaches rather than moves', () => {
        expect(page).toContain('selectedOrder.status,');
    });

    it('and the button opens a file picker instead of nothing', () => {
        expect(page).toContain('onClick={() => documentInputRef.current?.click()}');
        expect(page).toContain('ref={documentInputRef}');
        expect(page).toContain('disabled={isUploading}');
    });

    it('reporting a failure rather than swallowing it', () => {
        expect(page).toContain('setUploadError(uploaded?.error || "Upload failed")');
        expect(page).toContain('{uploadError && (');
    });

    it('and keeps the panel on the same order so the document appears', () => {
        // Refreshing and closing would leave the admin unsure it worked.
        expect(page).toContain('const updated = refreshed.data.find((o: any) => o.id === selectedOrder.id);');
        expect(page).toContain('if (updated) setSelectedOrder(updated);');
    });
});

describe('the export applications row actions', () => {
    const page = source(APPLICATIONS);

    it('the View Details eye opens the panel that already existed', () => {
        // THE test.
        expect(page).toContain('onClick={() => { setSelectedApp(standardApp); setIsRawDetailOpen(false); }}');
    });

    it('and is styled like the siblings it sat next to', () => {
        // It had no className either, so it rendered unstyled.
        const eye = page.slice(page.indexOf('title="View Details"') - 400, page.indexOf('title="View Details"'));
        expect(eye).toContain('p-1.5 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition');
    });

    it('and the two modals no longer open on top of each other', () => {
        // THE second defect, which fixing the first exposed.
        expect(page).toContain('{selectedApp && !isRawDetailOpen && (');
    });

    it('the raw modal still being the one gated on its own flag', () => {
        // Vacuity guard: both panels read the same selectedApp, which is why
        // only one of them may render at a time.
        expect(page).toContain('isOpen={isRawDetailOpen}');
        expect(page).toContain('onClick={() => { setSelectedApp(standardApp); setIsRawDetailOpen(true); }}');
    });
});

describe('the quiz Add Question menu', () => {
    /**
     *   #386 RETIRED THE SCREEN THIS REPAIR LIVED ON.
     *
     *        The defect was real: "Add Question" opened its menu on CSS :hover
     *        alone, so on a touch device the button did nothing while the empty
     *        state below it said `Click "Add Question" to get started.` It was
     *        repaired here, on /admin/academy/courses/[courseId]/quiz.
     *
     *        That screen is the only writer of COLLECTIONS.QUIZZES and has no way
     *        in, so the store is empty and the repair was never reached. #386
     *        retired the whole subsystem behind a flag.
     *
     *        The assertions move to the QUESTION THIS RAISES — does the editor
     *        admins actually use have the same defect? — rather than being
     *        deleted. It does not: its Add Question is a plain onClick button
     *        with no hover menu, so there is nothing here to repair.
     */
    const LIVE_EDITOR = 'src/app/admin/academy/[courseId]/quiz/[quizId]/page.tsx';

    it('THE LIVE EDITOR ADDS A QUESTION ON CLICK, WITH NO HOVER MENU', () => {
        const live = source(LIVE_EDITOR);
        // Windowed on the button itself. A file-wide scan for the hover class
        // was the first draft and it was wrong twice over: it failed on an
        // unrelated control, and it would have passed had the Add Question
        // button grown a hover menu somewhere else in the file.
        const button = live.slice(live.indexOf('onClick={handleAddQuestion}'));

        expect(live).toContain('onClick={handleAddQuestion}');
        expect(button.slice(0, 400)).not.toContain('group-hover:');
    });

    it('and no control on it is hover-only, which a touch device cannot reach', () => {
        // What the windowed check above found: the delete-option button WAS
        // `opacity-0 group-hover:opacity-100`, invisible on touch while still
        // tappable. Same defect as the retired screen's Add Question menu, on
        // the editor admins actually use. Now shown outright below `sm`.
        const live = source(LIVE_EDITOR);

        expect(live).not.toContain('"p-1 opacity-0 group-hover:opacity-100');
        expect(live).toContain('opacity-100 sm:opacity-0 sm:group-hover:opacity-100');
    });

    it('and the retired screen is a redirect now, not a hover menu', () => {
        const retired = source(QUIZ);

        expect(retired).toContain('redirect(');
        expect(retired).not.toContain('isQuestionMenuOpen');
    });
});

describe('the in-app notification preview', () => {
    it('renders its link as a span, not a focusable control', () => {
        const page = strip(source(IN_APP));

        expect(page).toContain('<span className="mt-2 inline-block text-xs text-emerald-400 font-medium">{linkText} →</span>');
        expect(page).not.toContain('hover:underline">{linkText} →</button>');
    });

    it('and it is a preview, so inert is the correct behaviour', () => {
        // Vacuity guard: if this were the real notification the fix would be a
        // handler rather than a different element.
        expect(source(IN_APP)).toContain('Your message will appear here.');
    });
});
