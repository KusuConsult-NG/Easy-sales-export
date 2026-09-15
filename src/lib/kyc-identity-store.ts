/**
 * Storing a national ID so that it can still be READ by the people who need it.
 *
 *   #779 THE ADMIN WAS SHOWN A SHA-256 DIGEST AND TOLD IT WAS THE MEMBER'S NIN.
 *
 *   Reported by the owner: "when admin is viewing the forms, the BVN and NIN
 *   are reported as a long line of numbers and characters not the Users inputs
 *   and when users are CSV files are exported no BVN and NIN and Voter's card
 *   numbers that users inputed."
 *
 *   Both halves are exactly right, and they have different causes.
 *
 * ── THE LONG LINE OF CHARACTERS IS A HASH, AND IT IS NOT REVERSIBLE ─────────
 *
 *   The WAVE submit path writes:
 *
 *       nin: applicantNin ? hashData(applicantNin) : null
 *       bvn: applicantBvn ? hashData(applicantBvn) : null
 *
 *   and hashData is `crypto.createHash('sha256')`. The admin detail modal
 *   renders whatever is on the row, so it renders sixty-four hex characters.
 *
 *   STATED PLAINLY, BECAUSE IT CANNOT BE FIXED BY CODE: a SHA-256 digest is
 *   one-way. For every application ALREADY SUBMITTED, the member's real NIN and
 *   BVN are not recoverable — not by this platform, not by anybody. No change
 *   here retrieves them. What the repair can do is stop presenting a digest as
 *   if it were the number, and make sure it does not happen again.
 *
 * ── WHY THE HASH EXISTS, AND WHY IT STAYS ───────────────────────────────────
 *
 *   It is not decoration. findConflictingApplication runs
 *
 *       .where("nin", "==", hashData(nin))
 *
 *   to refuse a second application on one identity. That is a genuine use of a
 *   hash — an equality check that never needs the original — and it is the
 *   platform's duplicate-identity guard. So `nin` and `bvn` keep holding
 *   exactly what they hold today. This finding ADDS a field; it changes none.
 *
 * ── AND WHY A HASH WAS THE WRONG TOOL FOR THE OTHER JOB ─────────────────────
 *
 *   Hashing answers "is this the same number?". KYC review asks "what is the
 *   number?", because a human has to compare it against a document. A digest
 *   cannot answer that, so the field was useless for the purpose it was
 *   collected for — which is what the owner is describing.
 *
 *   The tool for data that must be read back is ENCRYPTION, not hashing. Both
 *   are stored: the hash for the duplicate check, the ciphertext for the
 *   reviewer.
 *
 * ── FAILING SAFE, WHICH IS THE WHOLE RISK IN THIS CHANGE ────────────────────
 *
 *   Encryption needs a key. If KYC_ENCRYPTION_KEY is not set, this module
 *   stores NO ciphertext and reports `no-key` — it does not fall back to
 *   plaintext, and it does not throw. An application submitted without the key
 *   configured behaves exactly as it does today: hashed, unreadable, accepted.
 *   Refusing the submission instead would close WAVE registration over a
 *   missing environment variable, which is far worse than the defect.
 *
 *   The key is therefore worth setting, and its absence is visible rather than
 *   silent: the reviewer's screen says which of the two reasons applies.
 *
 * ── THE VOTER'S CARD WAS NEVER HASHED AT ALL ────────────────────────────────
 *
 *   It reaches the row through `...validatedData` with no transformation, so
 *   it is readable today and always has been. It was missing from the admin
 *   view and the CSV for the simpler reason that nobody put it there. It needs
 *   no decryption and gets none.
 */

import { encryptData, decryptData, hashData } from "@/lib/security";
import { logger } from "@/lib/logger";

/** The suffix for the readable copy: `nin` → `ninEncrypted`. */
export const ENCRYPTED_SUFFIX = "Encrypted";

/** How a stored identity number came back. */
export type KycReadState =
    /** Decrypted successfully — `value` is the member's own input. */
    | "readable"
    /** Stored before the readable copy existed. Not recoverable, ever. */
    | "legacy-hash-only"
    /** A readable copy exists but no key is configured to open it. */
    | "no-key"
    /** The member gave no number. */
    | "not-provided"
    /** A readable copy exists and could not be decrypted — wrong key, or damaged. */
    | "unreadable";

export interface KycReadResult {
    value: string | null;
    state: KycReadState;
    /** One sentence, safe to render to an administrator. */
    label: string;
}

/**
 * The key, or null.
 *
 * Read at call time rather than at module load: a module-level constant is
 * captured before the environment is populated in several of this codebase's
 * entry points, and a key that reads as absent would silently disable the
 * readable copy for a whole process.
 */
export function kycEncryptionKey(): string | null {
    const key = process.env.KYC_ENCRYPTION_KEY;
    if (typeof key !== "string") return null;
    const trimmed = key.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * What to write for one identity number.
 *
 * Returns the hash under the field's own name — UNCHANGED from today, because
 * the duplicate check queries it — and the ciphertext under `<field>Encrypted`
 * when a key is configured.
 *
 * `null` for a blank number, exactly as the existing writers do, so that a
 * missing number never becomes `hashData("")`: one constant digest shared by
 * every applicant without one would make them all duplicates of each other.
 */
export function storeKycNumber(raw: string | null | undefined): {
    hash: string | null;
    encrypted: string | null;
} {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) return { hash: null, encrypted: null };

    const key = kycEncryptionKey();
    let encrypted: string | null = null;

    if (key) {
        try {
            encrypted = encryptData(value, key);
        } catch (err) {
            //   Never fatal — see the header. The submission proceeds hashed,
            //   which is what it does today, and the operator is told.
            logger.error("[kyc-identity-store] could not encrypt an identity number", {
                reason: err instanceof Error ? err.message : String(err),
            });
            encrypted = null;
        }
    }

    return { hash: hashData(value), encrypted };
}

/**
 * Build the fields to spread onto a document for one identity number.
 *
 * A helper rather than a pattern to copy, because "the hash under the plain
 * name, the ciphertext under the suffixed one" is the kind of rule that gets
 * applied to two of the three places it names — which is this audit's most
 * repeated finding.
 */
export function kycNumberFields(field: string, raw: string | null | undefined): Record<string, string | null> {
    const { hash, encrypted } = storeKycNumber(raw);
    const out: Record<string, string | null> = { [field]: hash };
    //   Only written when there is something to write. A null here would
    //   overwrite a previously stored ciphertext on a resubmission made while
    //   the key happened to be unset.
    if (encrypted !== null) out[`${field}${ENCRYPTED_SUFFIX}`] = encrypted;
    return out;
}

/**
 * Just the readable copy, as fields to spread beside an existing hash write.
 *
 * Returns `{}` when there is nothing to add — no number, or no key — so that
 * spreading it is always safe and never overwrites a ciphertext stored earlier
 * with a null. The existing `nin:`/`bvn:` lines at each call site are left
 * exactly as they are: this finding adds a field and changes none, because the
 * duplicate check queries the ones that are already there.
 */
export function kycReadableField(field: string, raw: string | null | undefined): Record<string, string> {
    const { encrypted } = storeKycNumber(raw);
    return encrypted === null ? {} : { [`${field}${ENCRYPTED_SUFFIX}`]: encrypted };
}

/**
 * Read one identity number back for a reviewer.
 *
 * `row` is the stored document. The field's own name holds the hash; the
 * readable copy, if any, is beside it.
 */
export function revealKycNumber(
    row: Record<string, unknown> | null | undefined,
    field: string,
): KycReadResult {
    const data = row ?? {};
    const stored = data[field];
    const cipher = data[`${field}${ENCRYPTED_SUFFIX}`];

    const hasCipher = typeof cipher === "string" && cipher.trim().length > 0;
    const hasStored = typeof stored === "string" && stored.trim().length > 0;

    if (!hasCipher && !hasStored) {
        return { value: null, state: "not-provided", label: "Not provided" };
    }

    if (!hasCipher) {
        return {
            value: null,
            state: "legacy-hash-only",
            //   Says what happened AND that it is permanent, so nobody spends
            //   an afternoon looking for a way to decode it.
            label: "Recorded before numbers were stored readably — cannot be displayed",
        };
    }

    const key = kycEncryptionKey();
    if (!key) {
        return {
            value: null,
            state: "no-key",
            label: "Stored, but KYC_ENCRYPTION_KEY is not configured on this server",
        };
    }

    try {
        const value = decryptData(cipher as string, key);
        return { value, state: "readable", label: value };
    } catch (err) {
        logger.error("[kyc-identity-store] could not decrypt an identity number", {
            field,
            reason: err instanceof Error ? err.message : String(err),
        });
        return {
            value: null,
            state: "unreadable",
            label: "Stored, but could not be decrypted with the configured key",
        };
    }
}

/**
 * The identity numbers a reviewer should see, keyed for display.
 *
 * Returned under DISPLAY names rather than under `nin`/`bvn`, because those two
 * keys hold the hash and the duplicate check queries them — overwriting either
 * on its way to the screen is the kind of shortcut that makes a row mean two
 * different things depending on where you read it.
 *
 * The voter's card is included and is NOT decrypted: it was never hashed, so it
 * is already the member's own input. It is here so that one function answers
 * "what are this applicant's identity numbers", which is the question every
 * caller actually has.
 */
export function revealedIdentityFields(row: Record<string, unknown> | null | undefined): Record<string, string> {
    const data = row ?? {};
    const nin = revealKycNumber(data, "nin");
    const bvn = revealKycNumber(data, "bvn");

    const card = typeof data.votersCardNumber === "string" ? data.votersCardNumber.trim()
        : typeof data.votersCard === "string" ? data.votersCard.trim()
            : "";

    return {
        ninNumber: nin.label,
        bvnNumber: bvn.label,
        votersCardNumberDisplay: card || "Not provided",
    };
}

/**
 * The number with its middle hidden — `2210****391`.
 *
 * For a list or an export where a reviewer needs to recognise a number rather
 * than read it out. Anything too short to mask is returned unchanged rather
 * than padded, because inventing characters would be worse than showing it.
 */
export function maskKycNumber(value: string | null | undefined): string {
    const v = typeof value === "string" ? value.trim() : "";
    if (v.length < 7) return v;
    return `${v.slice(0, 4)}${"*".repeat(v.length - 7)}${v.slice(-3)}`;
}
