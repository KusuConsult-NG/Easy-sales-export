"use client";

import { useState } from "react";
import { GraduationCap, Clock, Users, Star, BookOpen } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

interface Course {
    id: string;
    title: string;
    category: string;
    level: string;
    duration: string;
    students: number;
    rating: number;
    price: number;
    instructor: string;
    description: string;
}

export default function AcademyPage() {
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [selectedLevel, setSelectedLevel] = useState("all");
    const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);
    const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
    const [enrollmentData, setEnrollmentData] = useState({
        fullName: "",
        email: "",
        phone: "",
    });

    const courses: Course[] = [
        {
            id: "1",
            title: "Modern Yam Farming Techniques",
            category: "farming",
            level: "beginner",
            duration: "4 weeks",
            students: 234,
            rating: 4.8,
            price: 15000,
            instructor: "Dr. Adamu Hassan",
            description: "Learn the latest scientific methods for maximizing yam yield",
        },
        {
            id: "2",
            title: "Export Documentation & Regulations",
            category: "export",
            level: "intermediate",
            duration: "3 weeks",
            students: 189,
            rating: 4.9,
            price: 25000,
            instructor: "Chioma Okeke",
            description: "Master the requirements for exporting Nigerian agricultural products",
        },
        {
            id: "3",
            title: "Agribusiness Management",
            category: "business",
            level: "intermediate",
            duration: "6 weeks",
            students: 312,
            rating: 4.7,
            price: 30000,
            instructor: "Musa Abdullahi",
            description: "Build a profitable agricultural business from the ground up",
        },
        {
            id: "4",
            title: "Organic Farming Certification",
            category: "farming",
            level: "advanced",
            duration: "8 weeks",
            students: 156,
            rating: 4.9,
            price: 35000,
            instructor: "Prof. Grace Okonkwo",
            description: "Get certified in organic farming practices and international standards",
        },
        {
            id: "5",
            title: "Post-Harvest Processing",
            category: "processing",
            level: "beginner",
            duration: "3 weeks",
            students: 201,
            rating: 4.6,
            price: 20000,
            instructor: "Ibrahim Yusuf",
            description: "Reduce losses and add value through proper processing techniques",
        },
        {
            id: "6",
            title: "Digital Marketing for Farmers",
            category: "business",
            level: "beginner",
            duration: "4 weeks",
            students: 287,
            rating: 4.8,
            price: 18000,
            instructor: "Fatima Bello",
            description: "Use social media and online platforms to reach more buyers",
        },
    ];

    const categories = [
        { value: "all", label: "All Categories" },
        { value: "farming", label: "Farming Techniques" },
        { value: "export", label: "Export & Trade" },
        { value: "business", label: "Business Management" },
        { value: "processing", label: "Processing & Storage" },
    ];

    const levels = [
        { value: "all", label: "All Levels" },
        { value: "beginner", label: "Beginner" },
        { value: "intermediate", label: "Intermediate" },
        { value: "advanced", label: "Advanced" },
    ];

    // Filter courses
    const filteredCourses = courses.filter((course) => {
        const matchesCategory =
            selectedCategory === "all" || course.category === selectedCategory;
        const matchesLevel =
            selectedLevel === "all" || course.level === selectedLevel;
        return matchesCategory && matchesLevel;
    });

    // Handle enrollment
    const handleEnroll = (course: Course) => {
        setSelectedCourse(course);
        setIsEnrollModalOpen(true);
    };

    const handleEnrollmentSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // TODO: Implement actual enrollment logic
        console.log("Enrolling", enrollmentData, "in", selectedCourse?.title);
        setIsEnrollModalOpen(false);
        setEnrollmentData({ fullName: "", email: "", phone: "" });
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            <div className="p-8">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                        Academy
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400">
                        Learn modern farming techniques and business skills from industry experts
                    </p>
                </div>

                {/* Filters */}
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 mb-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                Category
                            </label>
                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                {categories.map((cat) => (
                                    <option key={cat.value} value={cat.value}>
                                        {cat.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                                Difficulty Level
                            </label>
                            <select
                                value={selectedLevel}
                                onChange={(e) => setSelectedLevel(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                {levels.map((level) => (
                                    <option key={level.value} value={level.value}>
                                        {level.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Courses Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredCourses.length > 0 ? (
                        filteredCourses.map((course, index) => (
                            <div
                                key={course.id}
                                className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 hover-lift animate-[slideInUp_0.6s_ease-out]"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <span
                                        className={`px-3 py-1 rounded-full text-xs font-bold ${course.level === "beginner"
                                                ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                                : course.level === "intermediate"
                                                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                                                    : "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400"
                                            }`}
                                    >
                                        {course.level.charAt(0).toUpperCase() + course.level.slice(1)}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                                            {course.rating}
                                        </span>
                                    </div>
                                </div>

                                <div className="mb-4">
                                    <GraduationCap className="w-10 h-10 text-primary mb-3" />
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                        {course.title}
                                    </h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                                        {course.description}
                                    </p>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold">
                                        Instructor: {course.instructor}
                                    </p>
                                </div>

                                <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400 mb-4 pb-4 border-b border-slate-200 dark:border-slate-700">
                                    <div className="flex items-center gap-1">
                                        <Clock className="w-4 h-4" />
                                        {course.duration}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Users className="w-4 h-4" />
                                        {course.students} students
                                    </div>
                                </div>

                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-2xl font-bold text-primary">
                                        ₦{course.price.toLocaleString()}
                                    </span>
                                </div>

                                <button
                                    onClick={() => handleEnroll(course)}
                                    className="w-full px-4 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                                >
                                    <BookOpen className="w-4 h-4" />
                                    Enroll Now
                                </button>
                            </div>
                        ))
                    ) : (
                        <div className="col-span-full text-center py-12">
                            <p className="text-slate-500 dark:text-slate-400">
                                No courses match your filters
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Enrollment Modal */}
            <Modal
                isOpen={isEnrollModalOpen}
                onClose={() => setIsEnrollModalOpen(false)}
                title={`Enroll in ${selectedCourse?.title || "Course"}`}
            >
                <form onSubmit={handleEnrollmentSubmit} className="space-y-4">
                    <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 mb-4">
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                            Course Fee
                        </p>
                        <p className="text-2xl font-bold text-primary">
                            ₦{selectedCourse?.price.toLocaleString()}
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Full Name *
                        </label>
                        <input
                            type="text"
                            value={enrollmentData.fullName}
                            onChange={(e) =>
                                setEnrollmentData({ ...enrollmentData, fullName: e.target.value })
                            }
                            required
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Enter your full name"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Email Address *
                        </label>
                        <input
                            type="email"
                            value={enrollmentData.email}
                            onChange={(e) =>
                                setEnrollmentData({ ...enrollmentData, email: e.target.value })
                            }
                            required
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="your.email@example.com"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2">
                            Phone Number *
                        </label>
                        <input
                            type="tel"
                            value={enrollmentData.phone}
                            onChange={(e) =>
                                setEnrollmentData({ ...enrollmentData, phone: e.target.value })
                            }
                            required
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="+234 XXX XXX XXXX"
                        />
                    </div>

                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                        <p className="text-sm text-blue-800 dark:text-blue-200">
                            <strong>Note:</strong> After enrollment, you'll receive course access
                            details via email within 24 hours. Payment can be made via bank
                            transfer or card.
                        </p>
                    </div>

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => setIsEnrollModalOpen(false)}
                            className="flex-1 px-6 py-3 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-1 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary/90 transition-colors"
                        >
                            Confirm Enrollment
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
