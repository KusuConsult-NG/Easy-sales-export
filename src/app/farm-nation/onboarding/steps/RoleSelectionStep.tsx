"use client";

/**
 * Choosing which side of Farm Nation you are on.
 *
 *   #931 TWO OF ITS TWELVE PROMISES NAMED FEATURES THAT EXIST NOWHERE.
 *
 *   Swept against the whole tree: "Pricing analytics tools" and "Priority
 *   support" appear in this file and in no other, and neither has an
 *   implementation — src/app and src/lib hold no price-analytics of any kind
 *   and no support tiering. They are read at the moment somebody chooses, on
 *   the screen that asks them to choose, which is where a promise costs the
 *   most.
 *
 *   The other ten were checked too, and stand: escrow (my-purchases, list-land),
 *   verification (admin/farm-nation/land-verification), inquiries, offers
 *   (#874's one page for both sides), the Portfolio Value tile on the member
 *   dashboard, and no listing cap anywhere in createLandListingAction. Each is
 *   named against its file in the suite, so a bullet added later fails until
 *   somebody says where it lives.
 *
 *   AND "You can change this later" HAD NO DOOR. The role is stored at
 *   serviceRegistrations.farmNation.role and the only screen that can rewrite
 *   it is this wizard behind `?edit=true`, linked from the PENDING page alone —
 *   which an approved member never sees, because Farm Nation grants her roles at
 *   submit and sends her to the dashboard (#790). Worse, that path is
 *   `resubmitFarmNationApplicationAction`, which writes `status: "pending"`: a
 *   plain "edit your details" link would put an approved member back in the
 *   review queue. So the sentence says what is actually true instead, and the
 *   missing role-change door is recorded rather than improvised.
 *
 *   WHAT THE CHOICE ACTUALLY DECIDES, measured: rolesForFarmNationRole grants
 *   `investor` for a buyer and `farmer` for a seller, and the land-listing door
 *   asks hasAppAccess(roles, "farm-nation") — which either role satisfies. So
 *   neither answer shuts anybody out of listing or buying; what it changes is
 *   the roles on the account and the admin broadcast segment she falls into.
 *   That is worth saying plainly rather than implying a lock-in that is not
 *   there.
 */

import { useState } from "react";
import { ShoppingBag, Home as HomeIcon, User, CheckCircle } from "lucide-react";

interface RoleSelectionStepProps {
    onNext: (data: { role: "buyer" | "seller" | "both" }) => void;
    initialData?: "buyer" | "seller" | "both";
    onChange?: (data: any) => void;
}

export default function RoleSelectionStep({ onNext, onChange, initialData }: RoleSelectionStepProps) {
    const [selectedRole, setSelectedRole] = useState<"buyer" | "seller" | "both" | null>(
        initialData || null
    );

    function handleContinue() {
        if (selectedRole) {
            onNext({ role: selectedRole });
        }
    };

    const roles = [
        {
            id: "buyer" as const,
            title: "Property Buyer",
            description: "I want to buy or lease agricultural land",
            icon: ShoppingBag,
            features: [
                "Browse verified farmland listings",
                "Direct contact with landlords",
                "Secure escrow payments",
                "Legal documentation support",
            ],
        },
        {
            id: "seller" as const,
            title: "Property Seller",
            description: "I have land to sell or lease",
            icon: HomeIcon,
            features: [
                //   #931 Each of these names something in the tree — see the
                //   suite, which pins the bullet to the file that implements it.
                "List unlimited properties",
                "Reach thousands of buyers",
                "Inquiries and offers on your listings, in one place",
                "Professional property verification",
            ],
        },
        {
            id: "both" as const,
            title: "Both",
            description: "I want to buy and sell property",
            icon: User,
            features: [
                "Full buyer & seller access",
                "Portfolio management",
                "Investment tracking",
                //   #931 was "Priority support", which does not exist: the
                //   platform has one support address and no tiering.
                "Offers you make and receive, on one screen",
            ],
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">
                    How do you want to use Farm Nation?
                </h2>
                <p className="text-slate-600">
                    Choose the option that best describes your goals. It sets up your
                    dashboard and the roles on your account &mdash; neither answer closes
                    off listing land or buying it, so this is not a decision you can get
                    wrong.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                {roles.map((role) => {
                    const Icon = role.icon;
                    const isSelected = selectedRole === role.id;

                    return (
                        <button
                            key={role.id}
                            onClick={() => {
                                setSelectedRole(role.id);
                                onChange?.({ role: role.id });
                            }}
                            className={`relative p-6 rounded-2xl border-2 transition-all text-left ${isSelected
                                    ? "border-teal-600 bg-teal-50 shadow-lg scale-105"
                                    : "border-slate-200 hover:border-teal-300 hover:shadow-md"
                                }`}
                        >
                            {isSelected && (
                                <div className="absolute top-4 right-4">
                                    <div className="w-6 h-6 bg-teal-600 rounded-full flex items-center justify-center">
                                        <CheckCircle className="w-4 h-4 text-white" />
                                    </div>
                                </div>
                            )}

                            <div className="mb-4">
                                <div
                                    className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 ${isSelected
                                            ? "bg-teal-600 text-white"
                                            : "bg-slate-100 text-slate-600"
                                        }`}
                                >
                                    <Icon className="w-6 h-6" />
                                </div>
                                <h3
                                    className={`text-lg font-bold mb-1 ${isSelected
                                            ? "text-teal-900"
                                            : "text-slate-900"
                                        }`}
                                >
                                    {role.title}
                                </h3>
                                <p
                                    className={`text-sm ${isSelected
                                            ? "text-teal-700"
                                            : "text-slate-600"
                                        }`}
                                >
                                    {role.description}
                                </p>
                            </div>

                            <ul className="space-y-2">
                                {role.features.map((feature, index) => (
                                    <li
                                        key={index}
                                        className={`flex items-start gap-2 text-sm ${isSelected
                                                ? "text-teal-800"
                                                : "text-slate-900"
                                            }`}
                                    >
                                        <CheckCircle
                                            className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? "text-teal-600" : "text-slate-400"
                                                }`}
                                        />
                                        {feature}
                                    </li>
                                ))}
                            </ul>
                        </button>
                    );
                })}
            </div>

            <div className="flex justify-end pt-4">
                <button
                    onClick={handleContinue}
                    disabled={!selectedRole}
                    className="px-8 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Continue
                </button>
            </div>
        </div>
    );
}
