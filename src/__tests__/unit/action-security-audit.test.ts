/**
 * Action Security Audit Tests
 *
 * These tests statically scan the actions directory at test-time to ENFORCE
 * that every server action file contains the required security primitives.
 * They run in CI and the pre-push hook — if they fail, the push is blocked.
 *
 * Rules enforced:
 *  1. ALL action files must import requireSession OR be in the exemptions list
 *  2. ALL action files should use "use server" directive
 *
 * HOW TO ADD AN EXEMPTION:
 *  If a new action genuinely does not require a session (e.g., a public-facing
 *  health endpoint or password reset flow), add its RELATIVE path (from src/)
 *  to the EXEMPTIONS array below with a comment explaining why.
 *
 * DO NOT add files to the exemptions list without code review.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ACTIONS_DIR = join(process.cwd(), "src/app/actions");
const SRC_DIR = join(process.cwd(), "src");

// ─── Documented Exemptions ────────────────────────────────────────────────────
// Files that legitimately do not need a session guard.
// Add with a JSDoc comment explaining the reasoning.
const SESSION_GUARD_EXEMPTIONS = new Set([
  /** Public password-reset email flow — user is not authenticated yet */
  "app/actions/password-reset.ts",
  /** Telemetry endpoint — fire-and-forget, no user context needed */
  "app/actions/telemetry.ts",
  /** Schema standardization — admin maintenance script, protected at infra level */
  "app/actions/schema-standardization.ts",
  /** Investment export — data export utility, called from authenticated admin pages */
  "app/actions/export-investments.ts",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectActionFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectActionFiles(fullPath));
    } else if (entry.endsWith(".ts") && !entry.startsWith("index")) {
      files.push(fullPath);
    }
  }
  return files;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Action Security Audit", () => {
  const actionFiles = collectActionFiles(ACTIONS_DIR);

  it("should discover action files to audit (sanity check)", () => {
    expect(actionFiles.length).toBeGreaterThan(0);
  });

  describe("every action file must contain 'use server'", () => {
    for (const file of actionFiles) {
      const relPath = relative(SRC_DIR, file);
      it(`${relPath}`, () => {
        const content = readFileSync(file, "utf-8");
        expect(content).toMatch(/"use server"/);
      });
    }
  });

  describe("every non-exempt action must import requireSession, auth(), or requireAdmin", () => {
    const AUTH_PATTERN =
      /requireSession|requireAdmin|auth\(\)|getServerSession|getSession/;

    const violations: string[] = [];

    for (const file of actionFiles) {
      const relPath = relative(SRC_DIR, file);
      if (SESSION_GUARD_EXEMPTIONS.has(relPath)) continue;

      const content = readFileSync(file, "utf-8");
      if (!AUTH_PATTERN.test(content)) {
        violations.push(relPath);
      }
    }

    it("should have zero unauthenticated action files outside the exemptions list", () => {
      if (violations.length > 0) {
        const violationList = violations.map((v) => `  - ${v}`).join("\n");
        throw new Error(
          `\n\n🚨 ACTION SECURITY VIOLATION 🚨\n` +
            `The following ${violations.length} action file(s) have no session guard:\n\n` +
            violationList +
            `\n\nFIX: Add requireSession() from '@/lib/session-guard' to each file above.\n` +
            `If the action is genuinely public, add it to SESSION_GUARD_EXEMPTIONS in:\n` +
            `  src/__tests__/unit/action-security-audit.test.ts\n`
        );
      }
      expect(violations).toHaveLength(0);
    });
  });
});
