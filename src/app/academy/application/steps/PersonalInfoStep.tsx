"use client";

import { User, MapPin, Briefcase, Phone, Calendar } from "lucide-react";
import { NIGERIAN_LOCATIONS, STATES } from "@/lib/locations";

interface PersonalInfoData {
    firstName: string;
    lastName: string;
    otherName?: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    gender: string;
    state: string;
    lga: string;
    occupation: string;
}

interface PersonalInfoStepProps {
    data: PersonalInfoData;
    onChange: (data: PersonalInfoData) => void;
    errors: Record<string, string>;
}

export default function PersonalInfoStep({ data, onChange, errors }: PersonalInfoStepProps) {
    const handleChange = (field: keyof PersonalInfoData, value: string) => {
        if (field === "state") {
            onChange({ ...data, state: value, lga: "" });
        } else {
            onChange({ ...data, [field]: value });
        }
    };

    return (
        <div className="max-w-xl mx-auto space-y-4">
            <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    Personal Information
                </h2>
                <p className="text-slate-600">
                    Please provide your basic information to get started with the Academy.
                </p>
            </div>

            {/* KYC Notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3">
                <span className="text-amber-500 text-base shrink-0 mt-0.5">⚠️</span>
                <p className="text-sm text-amber-800 font-medium">
                    <strong>KYC Notice:</strong> Enter your name exactly as it appears on your NIN/BVN to avoid identity verification failure.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* First Name */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        First Name *
                        <span className="block text-xs font-normal text-slate-500 mt-0.5">As on your NIN/BVN</span>
                    </label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={data.firstName}
                            onChange={(e) => handleChange("firstName", e.target.value)}
                            className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.firstName ? "border-red-500" : "border-slate-300"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                            placeholder="e.g. Amina"
                        />
                    </div>
                    {errors.firstName && (
                        <p className="mt-1 text-sm text-red-600">{errors.firstName}</p>
                    )}
                </div>

                {/* Last Name */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Last Name *
                        <span className="block text-xs font-normal text-slate-500 mt-0.5">As on your NIN/BVN</span>
                    </label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={data.lastName}
                            onChange={(e) => handleChange("lastName", e.target.value)}
                            className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.lastName ? "border-red-500" : "border-slate-300"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                            placeholder="e.g. Ibrahim"
                        />
                    </div>
                    {errors.lastName && (
                        <p className="mt-1 text-sm text-red-600">{errors.lastName}</p>
                    )}
                </div>

                {/* Other Name - Optional */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Other Name
                        <span className="ml-2 text-xs font-normal text-slate-400">(Optional)</span>
                        <span className="block text-xs font-normal text-slate-500 mt-0.5">Middle name or additional name</span>
                    </label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={data.otherName || ""}
                            onChange={(e) => handleChange("otherName", e.target.value)}
                            className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                            placeholder="e.g. Fatima"
                        />
                    </div>
                </div>

                {/* Email */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Email Address *
                    </label>
                    <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="email"
                            value={data.email}
                            onChange={(e) => handleChange("email", e.target.value)}
                            className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.email ? "border-red-500" : "border-slate-300"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                            placeholder="your.email@example.com"
                        />
                    </div>
                    {errors.email && (
                        <p className="mt-1 text-sm text-red-600">{errors.email}</p>
                    )}
                </div>

                {/* Phone */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Phone Number *
                    </label>
                    <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="tel" style={{maxWidth:"180px"}}
                            value={data.phone}
                            onChange={(e) => handleChange("phone", e.target.value)}
                            className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.phone ? "border-red-500" : "border-slate-300"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                            placeholder="+234 800 000 0000"
                            maxLength={11}
                        />
                    </div>
                    {errors.phone && (
                        <p className="mt-1 text-sm text-red-600">{errors.phone}</p>
                    )}
                </div>

                {/* Date of Birth */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Date of Birth *
                    </label>
                    <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="date" style={{maxWidth:"180px"}}
                            value={data.dateOfBirth}
                            onChange={(e) => handleChange("dateOfBirth", e.target.value)}
                            className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.dateOfBirth ? "border-red-500" : "border-slate-300"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                        />
                    </div>
                    {errors.dateOfBirth && (
                        <p className="mt-1 text-sm text-red-600">{errors.dateOfBirth}</p>
                    )}
                </div>

                {/* Gender */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Gender *
                    </label>
                    <select
                        value={data.gender}
                        onChange={(e) => handleChange("gender", e.target.value)}
                        className={`w-full px-4 py-3 bg-white border ${errors.gender ? "border-red-500" : "border-slate-300"
                            } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                    >
                        <option value="">Select gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                    </select>
                    {errors.gender && (
                        <p className="mt-1 text-sm text-red-600">{errors.gender}</p>
                    )}
                </div>

                {/* State */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        State of Residence *
                    </label>
                    <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <select
                            value={data.state}
                            onChange={(e) => handleChange("state", e.target.value)}
                            className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.state ? "border-red-500" : "border-slate-300"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                        >
                            <option value="">Select your state</option>
                            {STATES.map((state) => (
                                <option key={state} value={state}>
                                    {state}
                                </option>
                            ))}
                        </select>
                    </div>
                    {errors.state && (
                        <p className="mt-1 text-sm text-red-600">{errors.state}</p>
                    )}
                </div>

                {/* LGA */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Local Government Area *
                    </label>
                    <select
                        value={data.lga}
                        onChange={(e) => handleChange("lga", e.target.value)}
                        disabled={!data.state}
                        className={`w-full px-4 py-3 bg-white border ${errors.lga ? "border-red-500" : "border-slate-300"
                            } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition disabled:opacity-50`}
                    >
                        <option value="">Select LGA</option>
                        {data.state && NIGERIAN_LOCATIONS[data.state]?.map((lga) => (
                            <option key={lga} value={lga}>{lga}</option>
                        ))}
                    </select>
                    {errors.lga && (
                        <p className="mt-1 text-sm text-red-600">{errors.lga}</p>
                    )}
                </div>

                {/* Occupation */}
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Current Occupation *
                    </label>
                    <div className="relative">
                        <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={data.occupation}
                            onChange={(e) => handleChange("occupation", e.target.value)}
                            className={`w-full pl-10 pr-3.5 py-2.5 bg-white border ${errors.occupation ? "border-red-500" : "border-slate-300"
                                } rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                            placeholder="e.g., Farmer, Student, Entrepreneur"
                        />
                    </div>
                    {errors.occupation && (
                        <p className="mt-1 text-sm text-red-600">{errors.occupation}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
