/**
 * @jest-environment node
 */

/**
 * A button that writes must say so when it is refused — #322, as a class.
 *
 * WHAT WAS FOUND
 * --------------
 * /admin/users' Gender Settings panel:
 *
 *     const res = await updateUserGenderAction(selectedUserForModal.id, "male");
 *     if (res.success) {
 *         showToast("Gender updated to Male", "success");
 *         ...
 *     }
 *
 * No else. On refusal the button did nothing, said nothing, and left the old
 * gender selected — indistinguishable from not having pressed it. The action
 * refuses three ways: no session, no `users:update` permission, and a write
 * that threw. The permission one is the case this button exists for: the panel
 * says "Correct this if the user is blocked from gender-specific programs
 * (e.g., WAVE)", so a module admin trying to unblock somebody was met with
 * silence and no reason to think it had not worked.
 *
 * #287–#289's shape (the loan form said nothing when refused), #315's, #310's.
 *
 * WHY A RATCHET AND NOT A SINGLE ASSERTION
 * ----------------------------------------
 * This is the fourth time this class has come back in a different screen. A
 * test that names /admin/users would not have caught it in the academy course
 * page or the messages page, and will not catch the fifth. So this walks every
 * .tsx and fails on any NEW write action whose refusal is discarded.
 *
 * HOW THE SCAN AVOIDS CRYING WOLF
 * -------------------------------
 * Two corrections were needed before it could be trusted, and both had already
 * produced wrong answers:
 *
 *   1. Comment lines are BLANKED, not deleted. Deleting them shifts every line
 *      number after the first comment; the first run pointed at unrelated code
 *      seven lines away, and at JSX in another file.
 *   2. The lookahead runs to the end of the ENCLOSING BLOCK, not a fixed window.
 *      With a 25-line window, five of seven "findings" were screens that handle
 *      the refusal correctly in an else past a long optimistic state update. A
 *      fixed window turns "I did not look far enough" into "the code is wrong",
 *      which is the worst kind of false positive because it reads like a
 *      finding.
 *
 * `(result as any).error` counts as a read too — several screens are written
 * that way, and requiring a bare dot after the variable reported the admin
 * disputes page while it was handling its refusal correctly.
 *
 * WHAT THIS RATCHET CANNOT SEE
 * ----------------------------
 * It reads text, so it cannot tell live code from dead. `} else if (false) {`
 * around a correct showToast passes every assertion here — that mutant was run
 * and it survived. Stated rather than papered over, because a gate whose limits
 * are undocumented gets trusted past them.
 *
 * It is the right trade anyway: the regression that actually happens is the
 * branch being dropped or never written, which is how all four instances of
 * this class arose, and deleting it is caught. A reviewer writing
 * `else if (false)` is doing something a test was never going to stop.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(process.cwd(), 'src');

/** Verbs that mean the call CHANGES something. A failed read is milder. */
const WRITE_VERB = /^(update|create|save|edit|delete|approve|reject|submit|add|remove|assign|grant|revoke|send|process|verify|suspend|activate|cancel|resolve|issue|generate|record|set|enroll|register|mark|toggle|publish|import|bulk)/i;

const CALL = /const\s+(\w+)\s*=\s*await\s+(\w*Action)\s*\(/g;

/**
 * Known-silent write call sites, as "<relative path>:<action>".
 *
 * EMPTY, and it must stay that way. An entry here is a screen where pressing a
 * button that changes data can fail with no visible outcome. Adding one is a
 * decision to ship that, and needs a reason written beside it.
 */
const ALLOWED = new Map<string, string>([]);

function tsxFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            tsxFiles(p, out);
        } else if (entry.endsWith('.tsx')) {
            out.push(p);
        }
    }
    return out;
}

/** Comment lines blanked, so line numbers still match the file on disk. */
function blankComments(src: string): string[] {
    const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length));
    return noBlocks
        .split('\n')
        .map((l) => (l.trim().startsWith('//') || l.trim().startsWith('*') || l.trim().startsWith('{/*') ? '' : l));
}

interface Silent { file: string; line: number; action: string; }

function findSilentWrites(): Silent[] {
    const found: Silent[] = [];

    for (const abs of tsxFiles(ROOT)) {
        const rel = abs.slice(process.cwd().length + 1);
        const lines = blankComments(readFileSync(abs, 'utf-8'));
        const code = lines.join('\n');

        CALL.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CALL.exec(code)) !== null) {
            const [, variable, action] = m;
            if (!WRITE_VERB.test(action)) continue;

            const line = code.slice(0, m.index).split('\n').length;

            // To the end of the enclosing block, by brace balance.
            let depth = 0;
            let end = line;
            for (let i = line - 1; i < Math.min(lines.length, line + 400); i++) {
                depth += (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length;
                end = i + 1;
                if (depth < 0) break;
            }
            const window = lines.slice(line - 1, end).join('\n');

            // A read of the refusal, in any of the spellings used in this tree:
            // `res.error`, `res?.error`, `(res as any).error`.
            const readsError = new RegExp(
                `\\b${variable}\\b\\s*(as\\s+\\w+\\s*\\)?)?[\\.\\?\\)]*\\s*\\.?\\s*error`,
            ).test(window);

            // A call whose result is never touched at all is fire-and-forget —
            // a different class, and not what this ratchet is about.
            const usesResult = new RegExp(`\\b${variable}\\b\\s*[\\.\\?\\)]`).test(window);

            if (usesResult && !readsError) found.push({ file: rel, line, action });
        }
    }
    return found;
}

describe('no write button fails in silence', () => {
    const silent = findSilentWrites();

    it('THE test: every write action that can be refused says so', () => {
        const unexpected = silent.filter((s) => !ALLOWED.has(`${s.file}:${s.action}`));

        expect(
            unexpected.map((s) => `${s.file}:${s.line}  ${s.action}`),
        ).toEqual([]);
    });

    it('the two /admin/users gender buttons report their refusal', () => {
        // The instances that produced this ratchet, pinned by name so a revert
        // fails here with the reason rather than only in the scan above.
        const page = readFileSync(join(ROOT, 'app/admin/users/page.tsx'), 'utf-8');

        // COUNTED, not matched. One `else` would satisfy a membership test
        // while the other button stayed silent — the membership-versus-count
        // trap this audit has hit four times.
        const calls = (page.match(/await updateUserGenderAction\(/g) ?? []).length;
        const reported = (page.match(/showToast\(res\.error \|\| "Could not update gender", "error"\)/g) ?? []).length;

        expect(calls).toBe(2);
        expect(reported).toBe(2);
    });

    it('the allow-list is empty', () => {
        // The vacuity guard. This ratchet is only worth having while nothing
        // has been waved through it; an entry is a decision to ship a button
        // that can fail invisibly, and should be argued for, not accumulated.
        expect([...ALLOWED.keys()]).toEqual([]);
    });

    it('the scan actually looks at the screens', () => {
        // Guards against the scan silently finding nothing because a path,
        // extension filter or regex broke — which would make every assertion
        // above pass while checking nothing at all.
        const files = tsxFiles(ROOT);
        const withWriteCalls = files.filter((f) => {
            const code = blankComments(readFileSync(f, 'utf-8')).join('\n');
            CALL.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = CALL.exec(code)) !== null) if (WRITE_VERB.test(m[2])) return true;
            return false;
        });

        expect(files.length).toBeGreaterThan(100);
        expect(withWriteCalls.length).toBeGreaterThan(20);
    });
});
