/**
 * @jest-environment jsdom
 */

/**
 *   #628 THE VOTER'S CARD FIELD COULD NOT ACCEPT ITS OWN EXAMPLE.
 *
 *   Both places that take a Voter Identification Number set `maxLength={19}`
 *   beside a placeholder of `90F5B123456789012345` — which is TWENTY
 *   characters. The field's own example did not fit in it.
 *
 *   With `showCount` on, this was not even silent: a member holding a
 *   twenty-character VIN watched the counter reach 19 / 19 with one character
 *   of their card still in hand, and no way to enter it.
 *
 * ── THE DECISION HAD ALREADY BEEN MADE, AND THE INPUTS IGNORED IT ───────────
 *
 *   kyc-validators reasoned this out in full and decided AGAINST a ceiling:
 *
 *       "the platform does not agree with itself about how long a voter's card
 *        is, there is no live database to settle it against, and #485's
 *        standing constraint is that onboarding must not stop — a rule that
 *        refuses a real member is worse than the defect it fixes."
 *
 *   Its own note even records the symptom — "the form truncates its own
 *   example". The VALIDATOR was then built without a ceiling: a floor of nine,
 *   alphanumeric only, and no single character repeated. The two INPUTS kept
 *   their cap. The fix reached the rule and not the doors.
 *
 *   And IdInput's header documented `maxLength={20}` as the Voter's Card
 *   example, which is the line somebody reads when adding the next identity
 *   field — so the cap would have come back. Both numbers are wrong for this
 *   field; the example is removed rather than corrected.
 *
 * ── WHAT STILL REFUSES A FAKE ───────────────────────────────────────────────
 *
 *   Everything that did before. Removing a ceiling nobody could justify does
 *   not remove the floor, the alphanumeric rule, or the repeated-character rule,
 *   and those are what stopped a single character being a verified identity
 *   document.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
    looksLikeFakeVotersCard,
    VOTERS_CARD_MIN_LENGTH,
} from '@/lib/kyc-validators';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * The same file with comments removed.
 *
 * An assertion about CODE must not be satisfied — or defeated — by PROSE, and
 * this file was defeated by its own. The #628 note added to KYCForm QUOTES the
 * placeholder, so `indexOf(PLACEHOLDER)` found the sentence rather than the
 * attribute, and the element slice started at the identity field BEFORE it —
 * the one capped at 11 on purpose. The positive control below is what caught it.
 *
 * Fourth time in this audit a check has matched its own documentation (#605,
 * #617, #620), which is why the helper exists rather than a one-off fix here.
 */
const code = (rel: string) => read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

/** Every screen that asks for a Voter Identification Number. */
const VIN_FIELDS = [
    'src/components/onboarding/KYCForm.tsx',
    'src/app/wave/application/steps/CivicStatusStep.tsx',
];

/** The example both fields show, and the length it actually is. */
const PLACEHOLDER = '90F5B123456789012345';

describe('#628 — the field accepts the number it asks for', () => {
    it('THE PLACEHOLDER REALLY IS TWENTY CHARACTERS — the premise, checked', () => {
        //   The whole finding rests on this count. Asserted rather than trusted,
        //   because a miscount here would make everything below theatre.
        expect(PLACEHOLDER).toHaveLength(20);
    });

    it.each(VIN_FIELDS)('%s STILL SHOWS THAT EXAMPLE', (file) => {
        //   Vacuity guard: if the placeholder were changed or removed, the
        //   assertion below would pass while the field had quietly stopped
        //   asking for a twenty-character number. Against the CODE, so a mention
        //   in a comment cannot stand in for the attribute.
        expect(code(file)).toContain(PLACEHOLDER);
    });

    it.each(VIN_FIELDS)('%s IMPOSES NO CEILING ON IT', (file) => {
        /*
         *   The fix. Scoped to the voter's-card input rather than the file —
         *   both files have other identity fields whose lengths ARE known and
         *   correctly capped (NIN and BVN at 11), and a whole-file assertion
         *   would forbid those too.
         */
        const src = code(file);
        const at = src.indexOf(PLACEHOLDER);
        expect(at).toBeGreaterThan(-1);

        //   The attributes of this one element: from the opening tag before the
        //   placeholder to the end of the tag after it.
        const tagStart = src.lastIndexOf('<IdInput', at);
        const tagEnd = src.indexOf('/>', at);
        const attributes = src.slice(tagStart, tagEnd);

        expect(attributes).not.toContain('maxLength');
        //   showCount goes with it: a count toward a limit that does not exist
        //   is a number with no meaning, and IdInput renders nothing for it.
        expect(attributes).not.toContain('showCount');
    });

    it('AND THE SLICE REALLY IS ONE ELEMENT — a positive control', () => {
        //   Without this, `attributes` covering nothing would satisfy both
        //   assertions above for any file at all.
        const src = code(VIN_FIELDS[0]);
        const at = src.indexOf(PLACEHOLDER);
        const attributes = src.slice(src.lastIndexOf('<IdInput', at), src.indexOf('/>', at));

        expect(attributes).toContain('<IdInput');
        expect(attributes).toContain(PLACEHOLDER);
        //   And it stops before the NEXT field, which is capped on purpose.
        expect(attributes).not.toContain('maxLength={11}');
    });

    it('AND IdInput NO LONGER DOCUMENTS A LENGTH FOR THIS FIELD', () => {
        //   The line that would put the cap back. Both 19 and 20 are wrong here,
        //   so the example is gone rather than corrected.
        const src = read('src/components/ui/IdInput.tsx');
        expect(src).not.toContain("maxLength={20}  → input is ~23ch wide");
        //   The NIN / BVN example stays: that length IS known.
        expect(src).toContain('maxLength={11}');
    });
});

describe('#628 — and removing the ceiling removed no protection', () => {
    it('A TWENTY-CHARACTER CARD IS ACCEPTED', () => {
        //   The member who could not previously type their own number.
        expect(looksLikeFakeVotersCard(PLACEHOLDER)).toBe(false);
    });

    it('AND A NINETEEN-CHARACTER ONE STILL IS TOO', () => {
        //   Whichever length is right, neither is refused — which is the point
        //   of having no ceiling while the true length is unknown.
        expect(looksLikeFakeVotersCard('90F5B12345678901234')).toBe(false);
    });

    it('BUT A SINGLE CHARACTER IS STILL NOT AN IDENTITY DOCUMENT', () => {
        for (const junk of ['A', '1', '', '   ']) {
            expect(looksLikeFakeVotersCard(junk)).toBe(true);
        }
    });

    it('AND NEITHER IS ONE CHARACTER REPEATED, OR A NON-ALPHANUMERIC STRING', () => {
        for (const junk of ['0000000000', 'AAAAAAAAAAA', '90F5B-12345-678', 'ABC DEF <script>']) {
            expect(looksLikeFakeVotersCard(junk)).toBe(true);
        }
    });

    it('AND THE FLOOR IS STILL WHERE IT WAS', () => {
        //   Pinned, because the ceiling and the floor are one line apart and
        //   removing the wrong one is the obvious way to break this.
        expect(VOTERS_CARD_MIN_LENGTH).toBe(9);
        expect(looksLikeFakeVotersCard('A2345678')).toBe(true);    // eight
        expect(looksLikeFakeVotersCard('A23456789')).toBe(false);  // nine
    });
});

describe('#628 — and the help cards stop pretending to be links', () => {
    /*
     *   THREE CARDS ON /help RENDERED AS `<Link href="#">` inside a box with a
     *   hover lift and a shadow — every signal a user reads as "this opens
     *   something" — and clicking did nothing at all. No navigation, no message,
     *   not even a 404 to explain itself.
     *
     *   On a HELP page, which is where somebody goes when they are ALREADY
     *   stuck, that is the worst place on the platform to put a control that
     *   ignores you.
     *
     *   An earlier note beside them called these "a content gap, real pages
     *   someone intends to write" and left them for the owner. That was right
     *   about the CONTENT and wrong about the CARD: waiting for the pages is a
     *   decision about content, shipping a dead control while waiting is not.
     *   Nothing is deleted — the intent to write them is real — but a resource
     *   with no destination renders as text with "Coming soon" on it.
     */
    const HELP = 'src/app/help/page.tsx';

    it('NO RESOURCE CARD POINTS AT "#"', () => {
        expect(code(HELP)).not.toContain('link: "#"');
    });

    it('AND THE ONES WITHOUT A PAGE ARE MARKED, NOT LINKED', () => {
        const src = code(HELP);
        //   `link: null` is what marks a resource as announced but not written.
        expect(src).toContain('link: null');
        expect(src).toContain('Coming soon');
        //   And the branch that decides between a link and plain text exists.
        expect(src).toContain('resource.link ? (');
    });

    it('AND THE CARDS THAT DO HAVE A DESTINATION ARE STILL LINKS', () => {
        //   The other way this goes wrong: turning every card into dead text.
        //   The support channels above the resources are real routes and must
        //   stay clickable.
        const src = code(HELP);
        expect(src).toContain('<Link');
        expect(src).toMatch(/href=\{resource\.link\}/);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: KYCForm caps the VIN at 19 again                   KILLED
 *     THE DEFECT: CivicStatusStep caps it again                      KILLED
 *     the floor is removed with the ceiling                          KILLED
 *     the alphanumeric rule is removed                               KILLED
 *     one character repeated becomes acceptable                      KILLED
 *     IdInput documents a Voter's Card length again                  KILLED
 *     the help cards go back to looking clickable                    KILLED
 *     a help card points at "#" again                                KILLED
 *     every help card becomes dead text                              KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THREE OF THOSE ARE THE WAYS THIS BECOMES A WORSE BUG RATHER THAN A FIX.
 *   Removing the ceiling must not take the floor, the alphanumeric rule or the
 *   repeated-character rule with it — those are what stopped a single character
 *   being a verified identity document. And turning every help card into dead
 *   text would "fix" the misleading links by removing the working ones.
 *
 * ── THE PROSE TRAP, A FOURTH TIME ───────────────────────────────────────────
 *
 *   Two assertions here failed against correct code first. The #628 note added
 *   to KYCForm QUOTES the placeholder, so `indexOf(PLACEHOLDER)` found the
 *   sentence rather than the attribute and the element slice began at the
 *   identity field before it — the one capped at 11 on purpose.
 *
 *   The positive control is what caught it, which is exactly what a positive
 *   control is for: without it the file would have reported a cap that is not
 *   there. Comments are stripped now, as #605, #617 and #620 each had to learn.
 */
