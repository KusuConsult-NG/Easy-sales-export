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
        // `available_?credit` and `credit_?limit` are here because
        // lib/cooperative-utils.ts held the multiplier twice under
        // `availableCredit` — the same rule ("how much may this member borrow
        // against their savings") under a name the pattern did not cover.
        namePattern: /^(max_?loan(_?amount|_?multiplier)?|available_?credit|credit_?limit|borrowing_?power)$/i,
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
 * A numeric literal, including a negated one, INCLUDING ONE BURIED IN
 * ARITHMETIC.
 *
 * THE HOLE THIS CLOSES
 * --------------------
 * The original rule was "a bare numeric literal assigned to a policy-named
 * variable", and the comment above it said an expression "is a derived value
 * and is fine". That is true when the expression derives from the constant:
 *
 *     const maxLoanAmount = getMaxLoanAmount(savings);          // fine
 *     const maxLoanAmount = savings * TIERS[t].maxLoanMultiplier; // fine
 *
 * It is not true when the expression contains the policy number itself:
 *
 *     const availableCredit = Math.max(0, savingsBalance * 0.5 - loanBalance);
 *
 * That is a copy of maxLoanMultiplier wearing an arithmetic disguise, and
 * lib/cooperative-utils.ts held two of them — a fourth copy of the very rule
 * this scanner was written to stop, sitting in its blind spot the whole time.
 *
 * So: an initializer is searched for numeric literals. An expression built
 * ENTIRELY from identifiers, property accesses and calls still passes, because
 * it contains no literal to find.
 */
/**
 * `0` and `1` are never a policy number here.
 *
 * Every rule in POLICY_CONCEPTS is a balance, a fee, a multiplier or a rate —
 * 5000, 10000, 0.5, 14, 5. Zero and one are identity and empty values:
 * `availableCredit: 0` in a not-a-member branch, `Math.max(0, ...)`, `x * 1`.
 * Flagging them is noise, and this scanner's value rests on having none.
 */
const NEVER_A_POLICY_VALUE = new Set(["0", "1"]);

/**
 * Is this a Zod schema, whose numbers are validation BOUNDS rather than values?
 *
 * `interestRate: z.number().min(0).max(100, "must be 0-100%")` says a percentage
 * cannot exceed one hundred. It is not a copy of the interest rate, and the
 * first version of the widened scan flagged it.
 */
function isValidationBound(node: ts.Node): boolean {
    let cursor: ts.Node = node;
    while (
        ts.isCallExpression(cursor) ||
        ts.isPropertyAccessExpression(cursor)
    ) {
        cursor = ts.isCallExpression(cursor) ? cursor.expression : cursor.expression;
    }
    return ts.isIdentifier(cursor) && cursor.text === "z";
}

function numericLiteralText(init: ts.Node | undefined): string | null {
    if (!init) return null;
    if (isValidationBound(init)) return null;

    if (ts.isNumericLiteral(init)) {
        return NEVER_A_POLICY_VALUE.has(init.text) ? null : init.text;
    }
    if (ts.isPrefixUnaryExpression(init) && ts.isNumericLiteral(init.operand)) {
        const sign = init.operator === ts.SyntaxKind.MinusToken ? "-" : "";
        return `${sign}${init.operand.text}`;
    }

    // A literal anywhere inside the expression.
    let found: string | null = null;
    const search = (node: ts.Node) => {
        if (found !== null) return;
        if (ts.isNumericLiteral(node) && !NEVER_A_POLICY_VALUE.has(node.text)) {
            found = node.text;
            return;
        }
        ts.forEachChild(node, search);
    };
    search(init);
    return found;
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
