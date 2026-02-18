"use client";

import { useState } from "react";
import { User, MapPin, Briefcase, Phone, Calendar } from "lucide-react";

interface PersonalInfoData {
    fullName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    state: string;
    occupation: string;
}

interface PersonalInfoStepProps {
    data: PersonalInfoData;
    onChange: (data: PersonalInfoData) => void;
    errors: Record<string, string>;
}

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe",
    "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara",
    "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau",
    "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"
];

export default function PersonalInfoStep({ data, onChange, errors }: PersonalInfoStepProps) {
    const handleChange = (field: keyof PersonalInfoData, value: string) => {
        onChange({ ...data, [field]: value });
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    Personal Information
                </h2>
                <p className="text-slate-600">
                    Please provide your basic information to get started with the Academy.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Full Name *
                    </label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={data.fullName}
                            onChange={(e) => handleChange("fullName", e.target.value)}
                            className={`w-full pl-11 pr-4 py-3 bg-white border ${errors.fullName ? "border-red-500" : "border-slate-300"
                                } rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                            placeholder="Enter your full name"
                        />
                    </div>
                    {errors.fullName && (
                        <p className="mt-1 text-sm text-red-600">{errors.fullName}</p>
                    )}
                </div>

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
                            className={`w-full pl-11 pr-4 py-3 bg-white border ${errors.email ? "border-red-500" : "border-slate-300"
                                } rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                            placeholder="your.email@example.com"
                        />
                    </div>
                    {errors.email && (
                        <p className="mt-1 text-sm text-red-600">{errors.email}</p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Phone Number *
                    </label>
                    <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="tel"
                            value={data.phone}
                            onChange={(e) => handleChange("phone", e.target.value)}
                            className={`w-full pl-11 pr-4 py-3 bg-white border ${errors.phone ? "border-red-500" : "border-slate-300"
                                } rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                            placeholder="+234 800 000 0000"
                        />
                    </div>
                    {errors.phone && (
                        <p className="mt-1 text-sm text-red-600">{errors.phone}</p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        Date of Birth *
                    </label>
                    <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="date"
                            value={data.dateOfBirth}
                            onChange={(e) => handleChange("dateOfBirth", e.target.value)}
                            className={`w-full pl-11 pr-4 py-3 bg-white border ${errors.dateOfBirth ? "border-red-500" : "border-slate-300"
                                } rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                        />
                    </div>
                    {errors.dateOfBirth && (
                        <p className="mt-1 text-sm text-red-600">{errors.dateOfBirth}</p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-2">
                        State of Residence *
                    </label>
                    <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <select
                            value={data.state}
                            onChange={(e) => handleChange("state", e.target.value)}
                            className={`w-full pl-11 pr-4 py-3 bg-white border ${errors.state ? "border-red-500" : "border-slate-300"
                                } rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
                        >
                            <option value="">Select your state</option>
                            {NIGERIAN_STATES.map((state) => (
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
                            className={`w-full pl-11 pr-4 py-3 bg-white border ${errors.occupation ? "border-red-500" : "border-slate-300"
                                } rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition`}
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
