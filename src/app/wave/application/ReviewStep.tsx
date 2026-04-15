/**
 * Step 7: Review & Submit
 * Final review of all application data before submission including Section G (Declaration & Consent)
 */

"use client";

import { useState } from "react";
import { ChevronLeft, CheckCircle, Edit, Loader2 } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import type { WaveApplicationData } from "./page";

interface Props {
    data: WaveApplicationData;
    onBack: () => void;
    onSubmit: () => Promise<void>;
    submitting: boolean;
    onEdit: (step: number) => void;
}

export default function ReviewStep({ data, onBack, onSubmit, submitting, onEdit }: Props) {
    const [declarationAccepted, setDeclarationAccepted] = useState(false);
    const [consentGiven, setConsentGiven] = useState(false);
    const { showToast } = useToast();

    async function handleSubmit() {
        if (!declarationAccepted || !consentGiven) {
            showToast("Please accept both the declaration and consent to continue", "error");
            return;
        }
        await onSubmit();
    };

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
                Review & Submit Application
            </h2>
            <p className="text-slate-600 mb-8">
                Please review all your information carefully before submitting
            </p>

            <div className="space-y-6">
                {/* Section A: Personal Identification */}
                <div className="bg-slate-50 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-slate-900">
                            Section A: Personal Identification
                        </h3>
                        <button
                            onClick={() => onEdit(0)}
                            className="flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-800 font-semibold"
                        >
                            <Edit className="w-4 h-4" />
                            Edit
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <p className="text-slate-600">Full Name</p>
                            <p className="font-medium text-slate-900">
                                {data.surname} {data.firstName} {data.otherNames}
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-600">Date of Birth / Age</p>
                            <p className="font-medium text-slate-900">
                                {data.dateOfBirth} ({data.age} years)
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-600">Phone</p>
                            <p className="font-medium text-slate-900">{data.phone}</p>
                        </div>
                        <div>
                            <p className="text-slate-600">Email</p>
                            <p className="font-medium text-slate-900">{data.email || "Not provided"}</p>
                        </div>
                        <div className="md:col-span-2">
                            <p className="text-slate-600">Residential Address</p>
                            <p className="font-medium text-slate-900">{data.residentialAddress}</p>
                        </div>
                        <div>
                            <p className="text-slate-600">State of Origin / LGA</p>
                            <p className="font-medium text-slate-900">
                                {data.stateOfOrigin}, {data.lgaOfOrigin}
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-600">State of Residence / LGA</p>
                            <p className="font-medium text-slate-900">
                                {data.stateOfResidence}, {data.lgaOfResidence}
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-600">Marital Status</p>
                            <p className="font-medium text-slate-900 capitalize">{data.maritalStatus}</p>
                        </div>
                        <div>
                            <p className="text-slate-600">Next of Kin</p>
                            <p className="font-medium text-slate-900">
                                {data.nextOfKinName} ({data.nextOfKinRelationship}) - {data.nextOfKinPhone}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Section B: Civic Status */}
                <div className="bg-slate-50 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-slate-900">
                            Section B: National Identity & Civic Status
                        </h3>
                        <button
                            onClick={() => onEdit(1)}
                            className="flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-800 font-semibold"
                        >
                            <Edit className="w-4 h-4" />
                            Edit
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <p className="text-slate-600">NIN</p>
                            <p className="font-medium text-slate-900">{data.nin}</p>
                        </div>
                        <div>
                            <p className="text-slate-600">Voter's Card Number</p>
                            <p className="font-medium text-slate-900">{data.votersCardNumber}</p>
                        </div>
                        <div>
                            <p className="text-slate-600">Polling Unit / Ward</p>
                            <p className="font-medium text-slate-900">
                                {data.pollingUnit}, {data.ward}
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-600">Voter Registration Year</p>
                            <p className="font-medium text-slate-900">{data.yearOfVoterRegistration}</p>
                        </div>
                        <div>
                            <p className="text-slate-600">Voted in Last Election?</p>
                            <p className="font-medium text-slate-900">
                                {data.votedInLastElection ? "Yes" : "No"}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Section C: Socio-Economic */}
                <div className="bg-slate-50 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-slate-900">
                            Section C: Socio-Economic Profile
                        </h3>
                        <button
                            onClick={() => onEdit(2)}
                            className="flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-800 font-semibold"
                        >
                            <Edit className="w-4 h-4" />
                            Edit
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <p className="text-slate-600">Education Level</p>
                            <p className="font-medium text-slate-900 capitalize">
                                {data.highestEducation.replace("_", " ")}
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-600">Current Occupation</p>
                            <p className="font-medium text-slate-900">{data.currentOccupation}</p>
                        </div>
                        <div>
                            <p className="text-slate-600">Monthly Income Range</p>
                            <p className="font-medium text-slate-900">
                                {data.averageMonthlyIncome === "below_50k" && "Below ₦50,000"}
                                {data.averageMonthlyIncome === "50k_100k" && "₦50,000 - ₦100,000"}
                                {data.averageMonthlyIncome === "100k_250k" && "₦100,000 - ₦250,000"}
                                {data.averageMonthlyIncome === "above_250k" && "Above ₦250,000"}
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-600">Involved in Agriculture?</p>
                            <p className="font-medium text-slate-900">
                                {data.involvedInAgriculture ? "Yes" : "No"}
                            </p>
                        </div>
                        {data.involvedInAgriculture && data.agricultureTypes.length > 0 && (
                            <div className="md:col-span-2">
                                <p className="text-slate-600">Agriculture Types</p>
                                <p className="font-medium text-slate-900 capitalize">
                                    {data.agricultureTypes.join(", ")}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Section D: Agricultural Interest */}
                <div className="bg-slate-50 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-slate-900">
                            Section D: Agricultural Interest & Value Chain
                        </h3>
                        <button
                            onClick={() => onEdit(3)}
                            className="flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-800 font-semibold"
                        >
                            <Edit className="w-4 h-4" />
                            Edit
                        </button>
                    </div>
                    <div className="space-y-3 text-sm">
                        <div>
                            <p className="text-slate-600">Value Chain Areas</p>
                            <p className="font-medium text-slate-900 capitalize">
                                {data.valueChainAreas.map((area) => area.replace(/_/g, " ")).join(", ")}
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-600">Preferred Commodities</p>
                            <p className="font-medium text-slate-900 capitalize">
                                {data.preferredCommodities.join(", ")}
                                {data.preferredCommodityOther && ` (Others: ${data.preferredCommodityOther})`}
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-600">Farmland Access</p>
                            <p className="font-medium text-slate-900">
                                {data.hasAccessToFarmland
                                    ? `Yes - ${data.farmlandHectares} hectares`
                                    : data.needsFarmlandAccess
                                        ? "No - Needs farmland access from WAVE"
                                        : "No"}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Section E: Financial Details */}
                <div className="bg-slate-50 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-slate-900">
                            Section E: Financial & Cooperative Details
                        </h3>
                        <button
                            onClick={() => onEdit(4)}
                            className="flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-800 font-semibold"
                        >
                            <Edit className="w-4 h-4" />
                            Edit
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                            <p className="text-slate-600">Bank Account</p>
                            <p className="font-medium text-slate-900">
                                {data.hasBankAccount
                                    ? `${data.bankName} - ${data.accountNumber}`
                                    : "No bank account"}
                            </p>
                        </div>
                        {data.bvn && (
                            <div>
                                <p className="text-slate-600">BVN</p>
                                <p className="font-medium text-slate-900">{data.bvn}</p>
                            </div>
                        )}
                        <div>
                            <p className="text-slate-600">Cooperative Member?</p>
                            <p className="font-medium text-slate-900">
                                {data.isMemberOfCooperative ? `Yes - ${data.cooperativeName}` : "No"}
                            </p>
                        </div>
                        <div>
                            <p className="text-slate-600">Willing to Join EASY SALES Cooperative?</p>
                            <p className="font-medium text-slate-900">
                                {data.willingToJoinCooperative ? "Yes" : "No"}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Section F: Training & Support */}
                <div className="bg-slate-50 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-slate-900">
                            Section F: Training, Support & Commitment
                        </h3>
                        <button
                            onClick={() => onEdit(5)}
                            className="flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-800 font-semibold"
                        >
                            <Edit className="w-4 h-4" />
                            Edit
                        </button>
                    </div>
                    <div className="space-y-3 text-sm">
                        <div>
                            <p className="text-slate-600">Support Needed</p>
                            <p className="font-medium text-slate-900 capitalize">
                                {data.supportNeeded.map((support) => support.replace(/_/g, " ")).join(", ")}
                            </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="flex items-center gap-2">
                                {data.willingToUndergoTraining ? (
                                    <CheckCircle className="w-5 h-5 text-green-600" />
                                ) : (
                                    <div className="w-5 h-5" />
                                )}
                                <span className="text-slate-900">Willing to undergo training</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {data.willingToComplyWithStandards ? (
                                    <CheckCircle className="w-5 h-5 text-green-600" />
                                ) : (
                                    <div className="w-5 h-5" />
                                )}
                                <span className="text-slate-900">Willing to comply with standards</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {data.willingToParticipateInME ? (
                                    <CheckCircle className="w-5 h-5 text-green-600" />
                                ) : (
                                    <div className="w-5 h-5" />
                                )}
                                <span className="text-slate-900">Willing to participate in M&E</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Section G: Declaration & Consent */}
                <div className="border-2 border-emerald-600 rounded-xl p-6 bg-emerald-50">
                    <h3 className="font-bold text-emerald-900 mb-4">
                        Section G: Declaration & Consent
                    </h3>
                    <div className="space-y-4">
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={declarationAccepted}
                                onChange={(e) => setDeclarationAccepted(e.target.checked)}
                                className="mt-1 w-5 h-5 text-emerald-700 border-slate-300 rounded focus:ring-emerald-600"
                            />
                            <div className="text-sm">
                                <p className="font-semibold text-slate-900 mb-1">
                                    Declaration of Truthfulness
                                </p>
                                <p className="text-slate-900">
                                    I hereby declare that all the information provided in this application form is
                                    true, accurate, and complete to the best of my knowledge. I understand that
                                    providing false or misleading information may result in disqualification from
                                    the WAVE program.
                                </p>
                            </div>
                        </label>

                        <label className="flex items-start gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={consentGiven}
                                onChange={(e) => setConsentGiven(e.target.checked)}
                                className="mt-1 w-5 h-5 text-emerald-700 border-slate-300 rounded focus:ring-emerald-600"
                            />
                            <div className="text-sm">
                                <p className="font-semibold text-slate-900 mb-1">
                                    Consent for Data Processing & Program Participation
                                </p>
                                <p className="text-slate-900">
                                    I consent to the processing of my personal data for the purposes of program
                                    management, monitoring, and evaluation. I agree to abide by the rules and
                                    regulations of the WAVE program and commit to actively participating in all
                                    required activities including training, monitoring, and evaluation.
                                </p>
                            </div>
                        </label>
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 gap-4">
                <button
                    onClick={onBack}
                    disabled={submitting}
                    className="flex items-center gap-2 px-6 py-3 border border-slate-300 rounded-xl font-semibold hover:bg-slate-50 transition-all text-slate-900 disabled:opacity-50"
                >
                    <ChevronLeft className="w-5 h-5" />
                    Back
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={!declarationAccepted || !consentGiven || submitting}
                    className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-10 py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {submitting ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Submitting...
                        </>
                    ) : (
                        <>
                            Submit Application
                            <CheckCircle className="w-5 h-5" />
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
