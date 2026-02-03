import { GraduationCap, Clock, Users, Star, Play, Award } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function AcademyPage() {
    // Mock course data
    const courses = [
        {
            id: "1",
            title: "Export Certification & Standards",
            description:
                "Learn international export standards, certifications, and quality control processes",
            instructor: "Dr. Adebayo Ogunleye",
            duration: "4 weeks",
            modules: 12,
            price: 25000,
            currency: "NGN",
            category: "export",
            level: "intermediate",
            enrollmentCount: 234,
            rating: 4.8,
            status: "open",
        },
        {
            id: "2",
            title: "Sustainable Farming Practices",
            description:
                "Master organic farming, crop rotation, and sustainable agricultural methods",
            instructor: "Mrs. Fatima Ibrahim",
            duration: "6 weeks",
            modules: 18,
            price: 30000,
            currency: "NGN",
            category: "farming",
            level: "beginner",
            enrollmentCount: 512,
            rating: 4.9,
            status: "open",
        },
        {
            id: "3",
            title: "Agricultural Business Management",
            description:
                "Essential skills for running a profitable agricultural business",
            instructor: "Mr. Chidi Okafor",
            duration: "5 weeks",
            modules: 15,
            price: 28000,
            currency: "NGN",
            category: "business",
            level: "intermediate",
            enrollmentCount: 189,
            rating: 4.7,
            status: "open",
        },
    ];

    const getLevelColor = (level: string) => {
        switch (level) {
            case "beginner":
                return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400";
            case "intermediate":
                return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400";
            case "advanced":
                return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400";
            default:
                return "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300";
        }
    };

    return (
        <div className="p-8">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                    <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                        <GraduationCap className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                        Easy Sales Academy
                    </h1>
                </div>
                <p className="text-slate-600 dark:text-slate-400">
                    Learn from industry experts and grow your agricultural business
                </p>
            </div>

            {/* Hero Banner */}
            <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-2xl p-8 text-white elevation-3 mb-8 animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]">
                <h2 className="text-2xl font-bold mb-4">
                    Invest in Your Agricultural Knowledge
                </h2>
                <p className="text-purple-100 mb-6 max-w-3xl">
                    Access expert-led courses on export regulations, sustainable farming,
                    business management, and more. All courses include certification upon
                    completion.
                </p>
                <button className="px-8 py-4 bg-white text-purple-600 font-bold rounded-xl hover:scale-105 transition-transform elevation-2">
                    Browse All Courses
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                {[
                    { label: "Total Courses", value: "24", icon: GraduationCap },
                    { label: "Expert Instructors", value: "15", icon: Users },
                    { label: "Active Students", value: "1,200+", icon: Play },
                    { label: "Certificates Issued", value: "850", icon: Award },
                ].map((stat, index) => (
                    <div
                        key={index}
                        className="bg-white dark:bg-slate-800 rounded-xl p-5 elevation-2 animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]"
                        style={{ animationDelay: `${100 + index * 50}ms` }}
                    >
                        <div className="flex items-center gap-3 mb-2">
                            <stat.icon className="w-5 h-5 text-primary" />
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {stat.label}
                            </p>
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {stat.value}
                        </p>
                    </div>
                ))}
            </div>

            {/* Featured Courses */}
            <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                    Featured Courses
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {courses.map((course, index) => (
                        <div
                            key={course.id}
                            className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden elevation-3 hover-glow animate-[slideInUp_0.6s_cubic-bezier(0.4,0,0.2,1)_both]"
                            style={{ animationDelay: `${200 + index * 100}ms` }}
                        >
                            {/* Course Thumbnail */}
                            <div className="h-40 bg-gradient-to-br from-purple-100 to-indigo-200 dark:from-purple-900 dark:to-indigo-800 flex items-center justify-center">
                                <GraduationCap className="w-16 h-16 text-purple-600 dark:text-purple-400" />
                            </div>

                            {/* Course Info */}
                            <div className="p-6">
                                <div className="flex items-center gap-2 mb-3">
                                    <span
                                        className={`px-3 py-1 rounded-full text-xs font-bold ${getLevelColor(
                                            course.level
                                        )}`}
                                    >
                                        {course.level.toUpperCase()}
                                    </span>
                                    <span className="px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-full">
                                        {course.category}
                                    </span>
                                </div>

                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                    {course.title}
                                </h3>

                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                                    {course.description}
                                </p>

                                <div className="flex items-center gap-4 mb-4 text-sm text-slate-600 dark:text-slate-400">
                                    <div className="flex items-center gap-1">
                                        <Clock className="w-4 h-4" />
                                        <span>{course.duration}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Play className="w-4 h-4" />
                                        <span>{course.modules} modules</span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 mb-4">
                                    <div className="flex items-center">
                                        {[...Array(5)].map((_, i) => (
                                            <Star
                                                key={i}
                                                className={`w-4 h-4 ${i < Math.floor(course.rating)
                                                        ? "text-yellow-500 fill-yellow-500"
                                                        : "text-slate-300 dark:text-slate-600"
                                                    }`}
                                            />
                                        ))}
                                    </div>
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        {course.rating}
                                    </span>
                                    <span className="text-sm text-slate-500 dark:text-slate-400">
                                        ({course.enrollmentCount} students)
                                    </span>
                                </div>

                                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                                    Instructor: {course.instructor}
                                </p>

                                <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                                    <div>
                                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                                            {formatCurrency(course.price)}
                                        </p>
                                    </div>
                                    <button className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold rounded-xl hover:scale-105 transition-transform elevation-2">
                                        Enroll Now
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Learning Path */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 elevation-2">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                    Recommended Learning Path
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        {
                            step: "1",
                            title: "Foundation Courses",
                            description:
                                "Start with basic agricultural and export fundamentals",
                        },
                        {
                            step: "2",
                            title: "Specialized Training",
                            description:
                                "Deep dive into your chosen area: farming, export, or business",
                        },
                        {
                            step: "3",
                            title: "Advanced Certification",
                            description:
                                "Complete capstone projects and earn professional certification",
                        },
                    ].map((path, index) => (
                        <div key={index} className="relative">
                            <div className="flex items-start gap-4">
                                <div className="w-10 h-10 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold shrink-0">
                                    {path.step}
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 dark:text-white mb-2">
                                        {path.title}
                                    </h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-400">
                                        {path.description}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
