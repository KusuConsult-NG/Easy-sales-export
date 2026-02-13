"use client";

import { useState } from "react";
import { ShoppingBag, Home as HomeIcon, User, CheckCircle } from "lucide-react";

interface RoleSelectionStepProps {
    onNext: (data: { role: "buyer" | "seller" | "both" }) => void;
    initialData?: "buyer" | "seller" | "both";
}

export default function RoleSelectionStep({ onNext, initialData }: RoleSelectionStepProps) {
    const [selectedRole, setSelectedRole] = useState<"buyer" | "seller" | "both" | null>(
        initialData || null
    );

    const handleContinue = () => {
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
                "List unlimited properties",
                "Reach thousands of buyers",
                "Pricing analytics tools",
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
                "Priority support",
            ],
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    How do you want to use Farm Nation?
                </h2>
                <p className="text-slate-600 dark:text-slate-400">
                    Choose the option that best describes your goals. You can change this later.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                {roles.map((role) => {
                    const Icon = role.icon;
                    const isSelected = selectedRole === role.id;

                    return (
                        <button
                            key={role.id}
                            onClick={() => setSelectedRole(role.id)}
                            className={`relative p-6 rounded-2xl border-2 transition-all text-left ${isSelected
                                    ? "border-teal-600 bg-teal-50 dark:bg-teal-900/20 shadow-lg scale-105"
                                    : "border-slate-200 dark:border-slate-700 hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-md"
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
                                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                                        }`}
                                >
                                    <Icon className="w-6 h-6" />
                                </div>
                                <h3
                                    className={`text-lg font-bold mb-1 ${isSelected
                                            ? "text-teal-900 dark:text-teal-100"
                                            : "text-slate-900 dark:text-white"
                                        }`}
                                >
                                    {role.title}
                                </h3>
                                <p
                                    className={`text-sm ${isSelected
                                            ? "text-teal-700 dark:text-teal-300"
                                            : "text-slate-600 dark:text-slate-400"
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
                                                ? "text-teal-800 dark:text-teal-200"
                                                : "text-slate-900 dark:text-white"
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
