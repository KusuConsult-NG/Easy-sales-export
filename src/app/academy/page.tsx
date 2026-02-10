"use client";

import { ArrowRight, BookOpen, Users, Award, Clock, TrendingUp, GraduationCap, CheckCircle, Home } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export default function AcademyLandingPage() {
    const featuredCourses = [
        {
            title: "Modern Yam Farming",
            instructor: "Dr. Adeyemi Ogunlade",
            students: 2450,
            duration: "8 weeks",
            price: "₦45,000",
            image: "/images/logo.jpg",
            category: "Farming"
        },
        {
            title: "Export Documentation & Compliance",
            instructor: "Mrs. Jennifer Okoro",
            students: 1820,
            duration: "6 weeks",
            price: "₦55,000",
            image: "/images/logo.jpg",
            category: "Export"
        },
        {
            title: "Agribusiness Management",
            instructor: "Prof. Ibrahim Musa",
            students: 3120,
            duration: "12 weeks",
            price: "₦75,000",
            image: "/images/logo.jpg",
            category: "Business"
        }
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Home Navigation Button */}
            <Link
                href="/"
                className="fixed top-6 left-6 z-50 flex items-center gap-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-4 py-2.5 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 border border-slate-200 dark:border-slate-700"
            >
                <Home className="w-4 h-4" />
                <span className="font-semibold text-sm">Home</span>
            </Link>

            {/* Hero Section */}
            <div className="relative overflow-hidden bg-linear-to-br from-blue-600 via-indigo-600 to-purple-600 text-white">
                <div className="absolute inset-0 bg-black/10"></div>
                <div className="relative max-w-7xl mx-auto px-8 py-24">
                    <div className="max-w-3xl">
                        <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-semibold mb-6">
                            <GraduationCap className="w-4 h-4" />
                            Agricultural Education Platform
                        </div>
                        <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
                            Easy Sales Academy
                        </h1>
                        <p className="text-xl md:text-2xl mb-4 text-blue-50">
                            Master Modern Agriculture & Agribusiness
                        </p>
                        <p className="text-lg mb-8 text-blue-100 max-w-2xl">
                            Learn from industry experts, earn recognized certifications, and transform your agricultural knowledge into profitable ventures.
                        </p>
                        <div className="flex flex-wrap gap-4">
                            <Link
                                href="/academy/application"
                                className="group inline-flex items-center gap-3 bg-white text-blue-600 px-8 py-4 rounded-xl font-bold text-lg shadow-2xl hover:shadow-blue-500/50 transition-all hover:scale-105"
                            >
                                Start Learning Today
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </Link>
                        </div>
                    </div>
                </div>
                {/* Wave SVG */}
                <div className="absolute bottom-0 left-0 right-0">
                    <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
                        <path d="M0 0L60 10C120 20 240 40 360 46.7C480 53 600 47 720 43.3C840 40 960 40 1080 46.7C1200 53 1320 67 1380 73.3L1440 80V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0V0Z" fill="rgb(248 250 252)" className="dark:fill-slate-950" />
                    </svg>
                </div>
            </div>

            {/* Stats Section */}
            <div className="max-w-7xl mx-auto px-8 -mt-16 relative z-10">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-16">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-blue-600 mb-2">50+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Expert Courses</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-blue-600 mb-2">25,000+</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Active Students</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-blue-600 mb-2">95%</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Completion Rate</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 text-center">
                        <div className="text-4xl font-bold text-blue-600 mb-2">4.8/5</div>
                        <div className="text-slate-600 dark:text-slate-400 font-medium">Student Rating</div>
                    </div>
                </div>
            </div>

            {/* Featured Courses */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 dark:text-white mb-4">
                    Featured Courses
                </h2>
                <p className="text-center text-slate-600 dark:text-slate-400 mb-12 max-w-2xl mx-auto">
                    Handpicked courses from industry experts to accelerate your agricultural success
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                    {featuredCourses.map((course, index) => (
                        <div key={index} className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden elevation-2 hover-lift">
                            <div className="relative h-48 bg-slate-200 dark:bg-slate-700">
                                <Image
                                    src={course.image}
                                    alt={course.title}
                                    fill
                                    className="object-cover"
                                />
                                <div className="absolute top-4 left-4">
                                    <span className="px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded-full">
                                        {course.category}
                                    </span>
                                </div>
                            </div>
                            <div className="p-6">
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                    {course.title}
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                                    by {course.instructor}
                                </p>
                                <div className="flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400 mb-4">
                                    <div className="flex items-center gap-1">
                                        <Users className="w-4 h-4" />
                                        {course.students.toLocaleString()}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Clock className="w-4 h-4" />
                                        {course.duration}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                                    <span className="text-2xl font-bold text-blue-600">
                                        {course.price}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="text-center">
                    <Link
                        href="/academy/courses"
                        className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition"
                    >
                        View All Courses
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                </div>
            </div>

            {/* Benefits Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 dark:text-white mb-12">
                    Why Learn With Us?
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mb-6">
                            <Award className="w-7 h-7 text-blue-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Certified Programs
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Earn industry-recognized certifications upon course completion to boost your credibility.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mb-6">
                            <BookOpen className="w-7 h-7 text-blue-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Practical Learning
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Hands-on projects and real-world case studies from successful Nigerian agribusinesses.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                        <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mb-6">
                            <TrendingUp className="w-7 h-7 text-blue-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                            Career Growth
                        </h3>
                        <p className="text-slate-600 dark:text-slate-400">
                            Access to job opportunities and business partnerships through our alumni network.
                        </p>
                    </div>
                </div>
            </div>

            {/* Learning Paths */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-800 rounded-3xl p-12">
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">
                        Learning Paths
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="flex items-start gap-4">
                            <CheckCircle className="w-6 h-6 text-blue-600 shrink-0 mt-1" />
                            <div>
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Farming Excellence</h4>
                                <p className="text-slate-600 dark:text-slate-400">Modern farming techniques, crop management, and yield optimization</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <CheckCircle className="w-6 h-6 text-blue-600 shrink-0 mt-1" />
                            <div>
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Export Mastery</h4>
                                <p className="text-slate-600 dark:text-slate-400">Documentation, compliance, and international trade regulations</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <CheckCircle className="w-6 h-6 text-blue-600 shrink-0 mt-1" />
                            <div>
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Agribusiness</h4>
                                <p className="text-slate-600 dark:text-slate-400">Business planning, financial management, and market strategy</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-4">
                            <CheckCircle className="w-6 h-6 text-blue-600 shrink-0 mt-1" />
                            <div>
                                <h4 className="font-bold text-slate-900 dark:text-white mb-1">Technology & Innovation</h4>
                                <p className="text-slate-600 dark:text-slate-400">AgTech, precision farming, and digital agriculture</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* CTA Section */}
            <div className="max-w-7xl mx-auto px-8 py-16">
                <div className="bg-linear-to-r from-blue-600 to-indigo-600 rounded-3xl p-12 text-center text-white relative overflow-hidden">
                    <div className="absolute inset-0 bg-black/10"></div>
                    <div className="relative z-10">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            Start Learning Today
                        </h2>
                        <p className="text-xl mb-8 text-blue-100 max-w-2xl mx-auto">
                            Join thousands of successful agripreneurs who transformed their careers through our courses.
                        </p>
                        <Link
                            href="/academy/courses"
                            className="group inline-flex items-center gap-3 bg-white text-blue-600 px-10 py-5 rounded-xl font-bold text-lg shadow-2xl hover:shadow-white/50 transition-all hover:scale-105"
                        >
                            Browse All Courses
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
