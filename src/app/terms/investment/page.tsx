import Link from "next/link";
import { COMPANY_INFO } from "@/lib/constants";
import { AlertTriangle, FileText, Mail, Phone } from "lucide-react";

/**
 *   #961 A CONSENT THAT NAMED A DOCUMENT NOBODY COULD READ.
 *
 *   export/onboarding/steps/TermsAcceptanceStep.tsx asks an investor to tick:
 *
 *       "I have read and agree to the Investment Terms and Conditions"
 *
 *   and links that phrase to /terms — eight sections covering services, account
 *   responsibility, payment, intellectual property, guarantees, liability,
 *   governing law and dispute resolution, and NOT ONE WORD about investment.
 *   So the member followed the link, found no such document, and ticked the box
 *   anyway, because the box is required to continue.
 *
 *   #926 measured the same page covering two of six modules. This is the half of
 *   that finding where the missing text is one somebody is asked to AGREE to.
 *
 * ── WHY THIS PAGE SAYS SO LITTLE, AND SAYS IT ON PURPOSE ────────────────────
 *
 *   The owner's instruction was placeholder pages plus honest consents, not
 *   drafted terms — and that is the right call. Investment terms for a flow
 *   where somebody commits funds against Nigerian agricultural export windows
 *   are a lawyer's work: SEC Nigeria's rules on collective investment schemes,
 *   CBN's on handling third-party funds, and the consumer-protection wording
 *   that goes with both. Text invented here would read as authoritative and
 *   bind nobody usefully, which is worse than a page that admits what is
 *   outstanding.
 *
 *   SO THIS PAGE DOES EXACTLY TWO THINGS: it names what is in force today, with
 *   a link, and it says plainly that the investment-specific terms are not
 *   published yet and how to ask what applies. It makes no promise about when
 *   they will be, because that is not this file's to give.
 *
 *   It is still a repair. Before it, the sentence "I have read and agree to the
 *   Investment Terms and Conditions" pointed at a document that did not exist.
 *   Now it points at a page that tells the member the truth about that.
 */
export default function InvestmentTermsPage() {
    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4">
            <div className="max-w-3xl mx-auto">
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-bold text-slate-900 mb-3">
                        Investment Terms and Conditions
                    </h1>
                    <p className="text-slate-600">
                        Export programme &middot; {COMPANY_INFO.fullName} &middot; {COMPANY_INFO.rc}
                    </p>
                </div>

                <div className="bg-white rounded-2xl shadow-lg p-8 lg:p-10 space-y-8">
                    {/* What is outstanding — first, because it is the point. */}
                    <section className="border-2 border-amber-300 bg-amber-50 rounded-xl p-6">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                            <div>
                                <h2 className="text-xl font-bold text-amber-900 mb-2">
                                    These terms are not yet published
                                </h2>
                                <p className="text-amber-900 leading-relaxed">
                                    The investment-specific terms for the export programme are
                                    being prepared with our legal advisers and are not available
                                    on this page yet. We are telling you that rather than showing
                                    you text that has not been settled.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* What IS in force. */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">
                            What applies in the meantime
                        </h2>
                        <p className="text-slate-600 leading-relaxed mb-4">
                            Your use of this platform is governed by our general{" "}
                            <Link href="/terms" className="text-primary font-semibold hover:underline">
                                Terms and Conditions
                            </Link>{" "}
                            and our{" "}
                            <Link href="/privacy" className="text-primary font-semibold hover:underline">
                                Privacy Policy
                            </Link>
                            . Those cover payment, intellectual property, limitation of liability,
                            governing law and dispute resolution, and they apply to the export
                            programme as they do to every other part of the platform.
                        </p>
                        <p className="text-slate-600 leading-relaxed">
                            They do not, on their own, set out terms specific to committing funds
                            to an export window — the returns, the conditions, how a window is
                            closed or cancelled, or what happens to money already committed. If
                            any of that matters to a decision you are about to make, please ask
                            us before you proceed.
                        </p>
                    </section>

                    {/* How to ask. A page that says "ask us" has to say how. */}
                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4">
                            Ask us what currently applies
                        </h2>
                        <p className="text-slate-600 leading-relaxed mb-4">
                            We will tell you the position in writing before you commit anything.
                        </p>
                        <div className="space-y-2">
                            <a
                                href={`mailto:${COMPANY_INFO.contact.general.email}`}
                                className="flex items-center gap-3 text-slate-700 hover:text-primary"
                            >
                                <Mail className="w-5 h-5" aria-hidden="true" />
                                {COMPANY_INFO.contact.general.email}
                            </a>
                            <a
                                href={`tel:${COMPANY_INFO.contact.general.phone}`}
                                className="flex items-center gap-3 text-slate-700 hover:text-primary"
                            >
                                <Phone className="w-5 h-5" aria-hidden="true" />
                                {COMPANY_INFO.contact.general.phone}
                            </a>
                            <Link
                                href="/contact"
                                className="flex items-center gap-3 text-slate-700 hover:text-primary"
                            >
                                <FileText className="w-5 h-5" aria-hidden="true" />
                                Contact form
                            </Link>
                        </div>
                    </section>
                </div>

                <div className="mt-8 flex justify-center gap-6 text-sm">
                    <Link href="/terms" className="text-primary hover:underline font-semibold">
                        General Terms and Conditions
                    </Link>
                    <Link href="/terms/escrow" className="text-primary hover:underline font-semibold">
                        Escrow Service Terms
                    </Link>
                </div>
            </div>
        </div>
    );
}
