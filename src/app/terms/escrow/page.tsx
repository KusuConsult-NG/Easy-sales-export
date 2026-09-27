import Link from "next/link";
import { COMPANY_INFO } from "@/lib/constants";
import { AlertTriangle, FileText, Mail, Phone, Shield } from "lucide-react";

/**
 *   #961 THE SECOND CONSENT THAT NAMED A DOCUMENT NOBODY COULD READ.
 *
 *   The same onboarding step asks an investor to tick:
 *
 *       "I agree to the Escrow Service Terms for fund protection"
 *
 *   and links it to /terms, which says nothing about escrow. The phrase "for
 *   fund protection" is the part that makes this worth fixing rather than
 *   noting: it tells the member their money is protected by an agreement, and
 *   then offers them no agreement to read.
 *
 *   Escrow terms are the lawyer's, for the same reason the investment ones are —
 *   CBN's rules on holding third-party funds are not something to improvise —
 *   so this page names what is in force, says what is outstanding, and stops.
 *
 *   WHAT IT DELIBERATELY DOES NOT SAY: that funds are held in any particular
 *   way, by any particular institution, or released on any particular trigger.
 *   The platform HAS an escrow implementation and this audit has worked on it;
 *   describing its mechanics here would be a statement about how somebody's
 *   money is handled, written by the wrong author. The release, refund and
 *   dispute paths that exist in code are not a customer agreement.
 */
export default function EscrowTermsPage() {
    return (
        <div className="min-h-screen bg-slate-50 py-12 px-4">
            <div className="max-w-3xl mx-auto">
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-bold text-slate-900 mb-3">
                        Escrow Service Terms
                    </h1>
                    <p className="text-slate-600">
                        {COMPANY_INFO.fullName} &middot; {COMPANY_INFO.rc}
                    </p>
                </div>

                <div className="bg-white rounded-2xl shadow-lg p-8 lg:p-10 space-y-8">
                    <section className="border-2 border-amber-300 bg-amber-50 rounded-xl p-6">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                            <div>
                                <h2 className="text-xl font-bold text-amber-900 mb-2">
                                    These terms are not yet published
                                </h2>
                                <p className="text-amber-900 leading-relaxed">
                                    The escrow service terms are being prepared with our legal
                                    advisers and are not available on this page yet. We would
                                    rather say so than publish wording about how your money is
                                    held before it has been settled.
                                </p>
                            </div>
                        </div>
                    </section>

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
                            , including the sections on payment, limitation of liability,
                            governing law and dispute resolution.
                        </p>
                        <p className="text-slate-600 leading-relaxed">
                            They do not set out the specific escrow arrangements — who holds
                            funds, on what conditions they are released or refunded, the fees
                            charged, or how a dispute over held funds is decided. Please ask us
                            for the current position before you place money in escrow.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                            <Shield className="w-6 h-6 text-slate-600" aria-hidden="true" />
                            Ask us before funds move
                        </h2>
                        <p className="text-slate-600 leading-relaxed mb-4">
                            We will confirm in writing how your funds are held, and on what
                            terms, before you commit them.
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
                    <Link href="/terms/investment" className="text-primary hover:underline font-semibold">
                        Investment Terms and Conditions
                    </Link>
                </div>
            </div>
        </div>
    );
}
