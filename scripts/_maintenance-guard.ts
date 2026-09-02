/**
 * One convention for maintenance scripts that write to a real database — #329.
 *
 * THREE SCRIPTS ALREADY HAD THE RIGHT SHAPE AND SEVEN DID NOT.
 *
 * repair-savings-balance.ts, backfill-fixed-savings-ledger.ts and
 * backfill-export-funding-goals.ts each hand-rolled the same preamble:
 *
 *     const APPLY = process.argv.includes('--apply');
 *     ...
 *     console.log(`Mode: ${APPLY ? 'APPLY' : 'report only (pass --apply to write)'}`);
 *
 * Every other writing script in this repository wrote immediately, on import,
 * against whatever `.env.local` pointed at — which, per migration 004's own
 * notes, is the production Supabase project. There was no report step, no
 * confirmation, and in three of them no way to tell a failed run from a
 * successful one: they ended `.catch(console.error)`, so the process exited 0
 * after the work had failed.
 *
 * Four hand-written copies of "am I allowed to write" would have become five.
 * This is the one copy. It is deliberately small — a flag, a hostname, and a
 * runner that cannot report success it did not achieve.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not the localhost refusal that seed-local.ts and cleanup-firebase.ts
 * carry. Those two are allowed to touch a whole database at once, so they
 * refuse a remote host outright unless an override states what is being done.
 * The scripts here are MEANT for production — repairing real rows is the point
 * — so the guard is a different one: nothing is written until a human has read
 * the report and re-run with --apply, and the target host is printed rather
 * than hidden.
 */

/**
 * Whether the operator asked for writes.
 *
 * `argv` is a parameter so this is testable without mutating process state.
 */
export function isApply(argv: readonly string[] = process.argv): boolean {
    return argv.includes("--apply");
}

/**
 * The hostname every write in the calling script goes to.
 *
 * Derived from the Supabase URL — the connection the writes actually travel
 * through — for the reason #304 established: a guard that inspects a system
 * the script does not touch is not a guard. Throws rather than defaulting,
 * because an unknown target must stop a script, not be waved through.
 */
export function targetHost(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string {
    if (!url) {
        throw new Error(
            "NEXT_PUBLIC_SUPABASE_URL is not set — refusing to run without knowing the target database.",
        );
    }
    return new URL(url).hostname;
}

/** The banner every script prints before doing anything. */
export function modeBanner(name: string, apply: boolean, host: string): string {
    return (
        `\n${name}\n` +
        `   Target:   ${host}\n` +
        `   Mode:     ${apply ? "⚠️  APPLY — this will write" : "report only (pass --apply to write)"}\n`
    );
}

/**
 * Run a maintenance script's main function.
 *
 * The reason this exists rather than each script calling `main().catch(...)`:
 * three of them ended in `.catch(console.error)`, which logs the failure and
 * then exits 0. Anything wrapping the script — a shell `&&`, a CI step, an
 * operator reading `$?` — saw success. A failed repair reporting success is the
 * defect this whole audit keeps finding; it should not be reachable by writing
 * one line slightly wrong.
 *
 * `process.exit(0)` on success is kept because these scripts hold open Supabase
 * connections that would otherwise delay the exit.
 */
export function runScript(name: string, main: () => Promise<unknown>): void {
    main()
        .then(() => {
            console.log(`\n✅ ${name} complete.`);
            process.exit(0);
        })
        .catch((err) => {
            console.error(`\n❌ ${name} FAILED — nothing below this point ran:`, err);
            process.exit(1);
        });
}
