/**
 * Find business rules written as a number where a policy module already states
 * them.
 *
 * WHY THIS EXISTS
 * ---------------
 * The recurring failure in this codebase is not a wrong number. It is a right
 * number in one file and a stale copy of it in another, with nothing that
 * notices they disagree. Every instance found so far has the same shape:
 *
 *   - COOPERATIVE_TIERS.Member.maxLoanMultiplier was corrected from 3 to 0.5,
 *     and _applyForLoanAction — the path the member UI actually submits
 *     through — kept `savingsBalance * 3` inline. The correction did not reach
 *     the one place that decides whether to lend, and a member was shown one
 *     limit and enforced at six times it.
 *
 *   - /api/cooperative/apply-loan held a third copy of the same rule as
 *     `amount * 2`, applied against the wrong balance field.
 *
 *   - lib/cooperative-limits.ts was created specifically to end the duplicate
 *     minimum-balance floor, and its header says so. platform.ts still carried
 *     `const MIN_BALANCE = 5000` afterwards — a third copy, added before the
 *     module existed and never moved over.
 *
 *   - /api/cooperatives/register charged `const registrationFee = 10000` while
 *     the other registration path read COOPERATIVE_CONFIG.registrationFee.
 *
 * Fixing each instance leaves the generator alone: nothing stops the next copy.
 * This is the check that does. A policy number assigned to a variable whose
 * name names the policy is the copy; everything else — a computed value, an
 * imported constant, a member of the defining module — passes.
 *
 * WHY THE RULE IS "LITERAL ASSIGNED TO A POLICY-NAMED VARIABLE"
 * ------------------------------------------------------------
 * Flagging every occurrence of 5000 or 10000 in src/ would be noise: they are
 * legitimate as an export row cap, a minimum withdrawal, a price filter bound.
 * Flagging every variable named maxLoanAmount would be wrong too — most are
 * computed from the constant, which is exactly what should happen.
 *
 * The intersection is what actually indicates a copy: a name that claims to be
 * the policy, holding a literal rather than deriving from the module that owns
 * it. That is narrow enough to have no false positives today and specific
 * enough to catch the next one.
 *
 * TO ADD A CONCEPT: add an entry to POLICY_CONCEPTS. To legitimise a call site
 * that must hold a literal, import the constant instead — that is the fix, and
 * there is deliberately no ignore list to reach for.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import * as ts from "typescript";

const ROOT = process.cwd();

export interface PolicyConcept {
    /** How the rule is described to a human in the failure message. */
    concept: string;
    /** Variable names that claim to BE this policy. */
    namePattern: RegExp;
    /** Where the value is actually defined — quoted in the failure message. */
    canonical: string;
    /**
     * Files allowed to hold the literal: the defining module, and anything
     * whose job is to state the number rather than apply it.
     */
    allowedFiles: string[];
}

export const POLICY_CONCEPTS: PolicyConcept[] = [
    {
        concept: "cooperative minimum balance",
        namePattern: /^(min|minimum)_?balance$/i,
        canonical: "COOPERATIVE_MINIMUM_BALANCE from @/lib/cooperative-limits",
        allowedFiles: ["src/lib/cooperative-limits.ts"],
    },
    {
        concept: "cooperative registration fee",
        namePattern: /^registration_?fee$/i,
        canonical: "COOPERATIVE_CONFIG.registrationFee from @/lib/constants",
        allowedFiles: ["src/lib/constants.ts"],
    },
    {
        concept: "maximum loan amount / multiplier",
        namePattern: /^max_?loan(_?amount|_?multiplier)?$/i,
        canonical: "getMaxLoanAmount / COOPERATIVE_TIERS.Member.maxLoanMultiplier from @/lib/cooperative-tiers",
        // loan-terms.ts owns MIN_LOAN_AMOUNT / MAX_LOAN_AMOUNT, which are the
        // absolute naira bounds a business loan may be written for — a
        // different rule from the multiplier, and defined there rather than
        // copied from anywhere.
        allowedFiles: ["src/lib/cooperative-tiers.ts", "src/lib/loan-terms.ts"],
    },
    {
        concept: "interest rate",
        namePattern: /^(default_?)?(monthly_?|annual_?)?interest_?rate$/i,
        canonical:
            "DEFAULT_MONTHLY_INTEREST_RATE from @/lib/cooperative-tiers (loans, MONTHLY), " +
            "BUSINESS_LOAN_MONTHLY_RATE from @/lib/loan-terms (business loans, MONTHLY), " +
            "or FIXED_SAVINGS_ANNUAL_RATE from @/lib/cooperative-savings (savings, ANNUAL)",
        allowedFiles: [
            "src/lib/cooperative-tiers.ts",
            "src/lib/loan-terms.ts",
            "src/lib/cooperative-savings.ts",
        ],
    },
    {
        concept: "fixed savings minimum amount",
        namePattern: /^fixed_?savings_?min(imum)?_?amount$/i,
        canonical: "FIXED_SAVINGS_MIN_AMOUNT from @/lib/cooperative-savings",
        allowedFiles: ["src/lib/cooperative-savings.ts"],
    },
    {
        concept: "loan term bounds",
        namePattern: /^(min|max)_?(term|duration)_?months?$/i,
        canonical: "MIN_TERM_MONTHS / MAX_TERM_MONTHS from @/lib/loan-terms",
        allowedFiles: ["src/lib/loan-terms.ts"],
    },
];

export interface PolicyCopy {
    file: string;
    line: number;
    variable: string;
    value: string;
    concept: string;
    canonical: string;
}

/** Every .ts/.tsx under src/, excluding tests and test harnesses. */
function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                // __tests__ and testing/ describe rules rather than apply them;
                // a test asserting "the floor is 5000" is the point of the test.
                if (entry === "__tests__" || entry === "__mocks__" || entry === "testing") continue;
                walk(full);
            } else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !entry.includes(".test.")) {
                out.push(full);
            }
        }
    };
    walk(join(ROOT, "src"));
    return out;
}

/**
 * A numeric literal, including a negated one. Anything else — an identifier, a
 * property access, a call, an expression — is a derived value and is fine.
 */
function numericLiteralText(init: ts.Node | undefined): string | null {
    if (!init) return null;
    if (ts.isNumericLiteral(init)) return init.text;
    if (ts.isPrefixUnaryExpression(init) && ts.isNumericLiteral(init.operand)) {
        const sign = init.operator === ts.SyntaxKind.MinusToken ? "-" : "";
        return `${sign}${init.operand.text}`;
    }
    return null;
}

/**
 * Scan for policy numbers written as literals outside the module that owns
 * them. Returns every copy found, so a failure lists all of them rather than
 * one at a time.
 */
export function scanForPolicyConstantCopies(): PolicyCopy[] {
    const copies: PolicyCopy[] = [];

    for (const file of sourceFiles()) {
        const rel = relative(ROOT, file).split("\\").join("/");
        const concepts = POLICY_CONCEPTS.filter(c => !c.allowedFiles.includes(rel));
        if (concepts.length === 0) continue;

        const source = ts.createSourceFile(
            file,
            readFileSync(file, "utf8"),
            ts.ScriptTarget.Latest,
            true,
            file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );

        const record = (node: ts.Node, name: string, value: string) => {
            for (const concept of concepts) {
                if (!concept.namePattern.test(name)) continue;
                const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
                copies.push({
                    file: rel,
                    line: line + 1,
                    variable: name,
                    value,
                    concept: concept.concept,
                    canonical: concept.canonical,
                });
            }
        };

        const visit = (node: ts.Node) => {
            // const interestRate = 14
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
                const value = numericLiteralText(node.initializer);
                if (value !== null) record(node, node.name.text, value);
            }

            // { interestRate: 14 } — written straight onto a stored document,
            // which is where the fourth copy of the fixed-savings rate lived.
            // A property holding an EXPRESSION (`interestRate: prod.interestRate`)
            // is recording terms rather than deciding them, and passes.
            if (ts.isPropertyAssignment(node)) {
                const key = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
                    ? node.name.text
                    : null;
                const value = numericLiteralText(node.initializer);
                if (key !== null && value !== null) record(node, key, value);
            }

            ts.forEachChild(node, visit);
        };

        visit(source);
    }

    return copies;
}
