/**
 * Whether the Forensic Scan is offered anywhere in the admin UI.
 *
 *   #765 THE OWNER TOOK IT OFF THE SCREEN, TEMPORARILY.
 *
 *       "the forensic button should be removed from the UI temporarily for
 *        now. the client doesnt need it."
 *
 *   A FLAG, NOT A DELETION, and the word in the instruction is why:
 *   "temporarily". Deleting the entry points would mean reconstructing them
 *   later from memory, and #266 exists because this screen was once reachable
 *   only by typing the URL — 747 lines of cross-module integrity checking that
 *   nothing called, with four repairs inside it no operator could read. Losing
 *   the way in again is the state this audit already had to fix once.
 *
 *   So everything stays: the route, the page, the action, the checks and every
 *   ratchet over them. What changes is that no link is rendered.
 *
 * ── TO PUT IT BACK ──────────────────────────────────────────────────────────
 *
 *   Set the constant below to `true`. That is the whole change — all three
 *   entry points read it, and a test pins that they do, so a fourth one added
 *   later cannot quietly bypass the owner's decision.
 *
 * ── WHAT IS NOT HIDDEN, AND WHY ─────────────────────────────────────────────
 *
 *   Three screens live under /admin/forensics and are NOT the scan: Duplicate
 *   Profiles (#724), Farm Nation Approvals (#725) and Coop Memberships (#726).
 *   Each is a queue an admin works, they are named separately in the sidebar,
 *   and the instruction was about the scan button. They stay.
 *
 * ── AND THE SCAN ITSELF STILL RUNS ──────────────────────────────────────────
 *
 *   A platform admin who has the URL reaches the page exactly as before; this
 *   is a visibility decision, not an authorisation one, and dressing it up as
 *   a lock would be a control that is none — #245's shape, which this codebase
 *   has met often enough to name.
 */
export const FORENSIC_SCAN_IN_NAV = false;
