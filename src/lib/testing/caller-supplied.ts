import * as ts from "typescript";

/**
 * WHAT THE CALLER CHOSE — one definition, for every scanner that needs it.
 *
 *   #638 found the ownership scanner reading PARAMETERS to decide whether a
 *   function takes a caller-supplied id. That is the whole story for a server
 *   action and half of it for a route handler, which takes `(req)` and reads
 *   the id out of the request:
 *
 *       export async function POST(req: Request) {
 *           const { userId } = await req.json();
 *
 *   So the scan saw one of the two doors and reported nothing about the other,
 *   across 123 route files.
 *
 *   #639 FOUND THE SAME BLIND SPOT IN fake-guard-scan, which asks the sharper
 *   question — is this authorisation check comparing a record against something
 *   the caller controls? — and had never been run over src/app/api at all. Its
 *   untrusted set was `parameterNames(fn)`, so the route form of its own
 *   reference defect was invisible to it:
 *
 *       const { listingId, ownerId } = await req.json();
 *       if (listingData.ownerId !== ownerId) return 403;   // pass the real owner's id
 *
 *   Rather than write the vocabulary a second time — which is the defect class
 *   this audit has found most often — it lives here and both scanners ask it.
 *   A third scanner asking a different question about the same values starts by
 *   importing this rather than by remembering which four shapes to match.
 *
 * WHAT COUNTS AS CALLER-SUPPLIED
 * ------------------------------
 * Everything a handler can be handed without a session saying so: the request
 * body, the query string, a form payload, and a dynamic route's params. NOT the
 * session, and not values derived from it — that is each scanner's own
 * `sessionDerived` set, which stays where it is because "trusted" means
 * something slightly different to each of them.
 */

/** An expression whose value the caller supplied. */
export const CALLER_SUPPLIED_SOURCE =
    /\b(?:req|request)\b[\s\S]*?\.(?:json|formData|text)\(\)|\bawait\s+params\b|\bsearchParams\b/;

/** A binding or key that names an identifier rather than a value. */
export const ID_LIKE_NAME = /(?:^|_)ids?$|Ids?$|^ids?$|ref$/i;

/** Receivers whose `.get("x")` returns something the caller chose. */
const PAYLOAD_RECEIVER = /searchParams|formData|params|body|query/i;

/**
 * Names bound to a REQUEST PAYLOAD — `const form = await req.formData()`.
 *
 * Collected separately because a handler routinely gives the payload its own
 * name, and a rule that only recognised the word `formData` read
 *
 *     const form = await req.formData();
 *     const memberId = form.get("memberId");
 *
 * as clean. Matching the shapes in front of you rather than the shape of the
 * thing is the narrowing #638 was about, so it is not repeated here.
 */
export function callerPayloadNames(fn: ts.Node): Set<string> {
    const names = new Set<string>();
    const visit = (n: ts.Node) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
            && CALLER_SUPPLIED_SOURCE.test(n.initializer.getText())) {
            names.add(n.name.text);
        }
        ts.forEachChild(n, visit);
    };
    visit(fn);
    return names;
}

/** Is this `.get("something")` reading a value off a caller payload? */
export function isPayloadGet(n: ts.CallExpression, payloadNames: Set<string>): string | null {
    if (!ts.isPropertyAccessExpression(n.expression)) return null;
    if (n.expression.name.text !== "get") return null;

    const key = n.arguments[0];
    if (!key || !ts.isStringLiteral(key)) return null;

    const receiver = n.expression.expression.getText();
    const receiverRoot = receiver.split(/[^\w$]/).filter(Boolean).pop() ?? "";
    const known = PAYLOAD_RECEIVER.test(receiver)
        || payloadNames.has(receiver)
        || payloadNames.has(receiverRoot);

    return known ? key.text : null;
}

/**
 * Every NAME in this function holding a value the caller supplied.
 *
 * Parameters, bindings destructured from a request payload, and the results of
 * `payload.get("x")`. This is the untrusted set: a comparison against any of
 * these is a comparison against something the caller wrote.
 */
export function callerSuppliedNames(fn: ts.Node): Set<string> {
    const names = new Set<string>();

    const params = (fn as any).parameters as ts.NodeArray<ts.ParameterDeclaration> | undefined;
    for (const p of params ?? []) {
        if (ts.isIdentifier(p.name)) names.add(p.name.text);
        if (ts.isObjectBindingPattern(p.name)) {
            for (const el of p.name.elements) {
                if (ts.isIdentifier(el.name)) names.add(el.name.text);
            }
        }
    }

    const payloadNames = callerPayloadNames(fn);

    const visit = (n: ts.Node) => {
        if (ts.isVariableDeclaration(n) && n.initializer) {
            const init = n.initializer.getText();

            //   `const { userId } = await req.json()` / `= await params`
            if (CALLER_SUPPLIED_SOURCE.test(init)) {
                if (ts.isObjectBindingPattern(n.name)) {
                    for (const el of n.name.elements) {
                        if (ts.isIdentifier(el.name)) names.add(el.name.text);
                    }
                } else if (ts.isIdentifier(n.name)) {
                    names.add(n.name.text);
                }
            }

            //   `const memberId = form.get("memberId")`
            if (ts.isIdentifier(n.name) && ts.isCallExpression(n.initializer)
                && isPayloadGet(n.initializer, payloadNames) !== null) {
                names.add(n.name.text);
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(fn);

    return names;
}
