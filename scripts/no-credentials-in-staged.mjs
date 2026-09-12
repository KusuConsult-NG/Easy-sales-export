#!/usr/bin/env node
/**
 * Refuse a commit that carries a live credential — #662.
 *
 * WHY THIS EXISTS
 * ---------------
 * A Paystack `sk_live_` key is in this repository's history: added in
 * `c767ff8e`, removed in `a57f5e95`. Removing it from the working tree did not
 * remove it from the history, and it is still recoverable by anyone who can
 * clone. Rotation is the only remedy for THAT key, and it is the owner's to do.
 *
 * What is this repository's to do is make the next one impossible to commit.
 * CI already scans the FULL history with gitleaks and fetch-depth: 0 — but CI
 * runs after the push, and by then the secret is on a remote and the only
 * remedy is rotation again. This runs before the commit exists.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a replacement for gitleaks and does not try to be. gitleaks carries
 * hundreds of rules and an entropy model; this is a short list of shapes that
 * are unambiguous, cost nothing to check, and cover the credentials this
 * platform actually holds. A narrow check that runs on every commit is worth
 * more than a broad one that runs after the push.
 *
 * It also does not scan the whole tree — only what is STAGED. Anything already
 * committed is gitleaks' job, and re-reporting it on every commit would make
 * this hook something people disable.
 */

import { execFileSync } from "node:child_process";

/**
 * Shapes that are a credential and not anything else.
 *
 * Every one of these is a prefix a provider assigns, so a match is not a guess.
 * Deliberately NOT included: anything matching `password`, `secret` or `token`
 * by name — this codebase is full of those words in variable names, comments
 * and test fixtures, and a check that fires on correct code is a check that
 * gets switched off.
 */
const RULES = [
    { name: "Paystack live secret key", re: /\bsk_live_[0-9a-zA-Z]{20,}/ },
    { name: "Paystack test secret key", re: /\bsk_test_[0-9a-zA-Z]{20,}/ },
    { name: "Stripe secret key", re: /\brk_live_[0-9a-zA-Z]{20,}/ },
    { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    { name: "OpenAI key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
    { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
    {
        //   A Supabase service-role key is a JWT whose payload names the role.
        //   Matched on the decoded claim rather than on "looks like a JWT",
        //   because a JWT in a test fixture is ordinary and this is not.
        name: "Supabase service-role JWT",
        re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
        confirm: (match) => {
            try {
                const payload = JSON.parse(
                    Buffer.from(match.split(".")[1], "base64url").toString("utf8"),
                );
                return payload?.role === "service_role";
            } catch {
                return false;
            }
        },
    },
];

/** Files git will not usefully diff, and files that exist to hold examples. */
const SKIP = [
    /^\.env\.example$/,
    /(^|\/)package-lock\.json$/,
    //   This file, and the test that proves it works — both necessarily
    //   contain the shapes they look for.
    /^scripts\/no-credentials-in-staged\.mjs$/,
    /(^|\/)no-credential-reaches-a-commit\.test\.ts$/,
];

function stagedFiles() {
    const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
        encoding: "utf8",
    });
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

function stagedContent(file) {
    try {
        return execFileSync("git", ["show", `:${file}`], {
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
        });
    } catch {
        //   Binary, deleted, or unreadable. Nothing to scan.
        return "";
    }
}

/**
 * Every credential in `text`, as { rule, file, line }.
 *
 * Exported shape rather than a boolean so the test can ask it questions with
 * known answers — a check that can only say yes or no cannot be verified
 * without running the whole hook.
 */
export function findCredentials(text, file = "<input>") {
    const found = [];
    text.split("\n").forEach((line, i) => {
        for (const rule of RULES) {
            const m = rule.re.exec(line);
            if (!m) continue;
            if (rule.confirm && !rule.confirm(m[0])) continue;
            found.push({ rule: rule.name, file, line: i + 1 });
        }
    });
    return found;
}

function main() {
    const files = stagedFiles().filter((f) => !SKIP.some((s) => s.test(f)));
    const found = files.flatMap((f) => findCredentials(stagedContent(f), f));

    if (found.length === 0) return 0;

    console.error("");
    console.error("  COMMIT REFUSED — a credential is staged.");
    console.error("");
    for (const f of found) {
        console.error(`    ${f.file}:${f.line}   ${f.rule}`);
    }
    console.error("");
    console.error("  A secret that reaches a commit is a secret that has to be ROTATED,");
    console.error("  whether or not it is ever pushed — removing it later leaves it in the");
    console.error("  history. This repository already carries one such key from c767ff8e.");
    console.error("");
    console.error("  Put the value in an environment variable and commit the NAME.");
    console.error("");
    return 1;
}

//   Only when run as the hook, so the test can import findCredentials without
//   the process exiting under it.
if (process.argv[1] && process.argv[1].endsWith("no-credentials-in-staged.mjs")) {
    process.exit(main());
}
