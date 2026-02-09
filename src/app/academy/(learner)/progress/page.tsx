import { TrendingUp, Award, Clock, Target, CheckCircle, BookOpen, Trophy } from "lucide-react";

// Mock data - will be replaced with real Firestore data
const PROGRESS_DATA = {
    totalCourses: 3,
    completedCourses: 1,
    inProgressCourses: 2,
    totalHoursLearned: 45,
    certificatesEarned: 1,
    currentStreak: 7,
    totalLessons: 62,
    completedLessons: 41,
    overallProgress: 66
};

const RECENT_ACTIVITY = [
    { id: "1", type: "lesson", title: "Yam Seed Selection", course: "Modern Farming Techniques", date: "Today", completed: true },
    { id: "2", type: "quiz", title: "Export Forms Quiz", course: "Export Documentation", date: "Yesterday", score: 85 },
    { id: "3", type: "lesson", title: "Phytosanitary Certificates", course: "Export  Documentation", date: "2 days ago", completed: true },
    { id: "4", type: "certificate", title: "Agribusiness Fundamentals", course: "Agribusiness Fundamentals", date: "1 week ago", completed: true }
];

const LEARNING_PATHS_PROGRESS = [
    { name: "Farming Excellence", progress: 75, courses: 2, completedCourses: 1, color: "green" },
    { name: "Export Mastery", progress: 40, courses: 2, completedCourses: 0, color: "blue" },
    { name: "Agribusiness", progress: 100, courses: 1, completedCourses: 1, color: "purple" }
];

export default function ProgressPage() {
    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Learning Progress
                </h1>
                <p className="text-slate-600 dark:text-slate-400">
                    Track your achievements and learning milestones
                </p>
            </div>

            {/* Overview Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                    <div className="flex flex-col items-center text-center">
                        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center mb-3">
                            <BookOpen className="w-6 h-6 text-blue-600" />
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {PROGRESS_DATA.totalCourses}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Total Courses</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                    <div className="flex flex-col items-center text-center">
                        <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center mb-3">
                            <CheckCircle className="w-6 h-6 text-green-600" />
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {PROGRESS_DATA.completedCourses}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Completed</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                    <div className="flex flex-col items-center text-center">
                        <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center mb-3">
                            <Award className="w-6 h-6 text-yellow-600" />
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {PROGRESS_DATA.certificatesEarned}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Certificates</p>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                    <div className="flex flex-col items-center text-center">
                        <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center mb-3">
                            <Trophy className="w-6 h-6 text-orange-600" />
                        </div>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                            {PROGRESS_DATA.currentStreak}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Day Streak</p>
                    </div>
                </div>
            </div>

            {/* Overall Progress */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">Overall Progress</h2>
                    <span className="text-2xl font-bold text-blue-600">{PROGRESS_DATA.overallProgress}%</span>
                </div>
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                    <div
                        className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full transition-all"
                        style={{ width: `${PROGRESS_DATA.overallProgress}%` }}
                    />
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                    {PROGRESS_DATA.completedLessons} of {PROGRESS_DATA.totalLessons} lessons completed
                </p>
            </div>

            {/* Learning Paths Progress */}
            <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                    Learning Paths
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {LEARNING_PATHS_PROGRESS.map((path) => (
                        <div
                            key={path.name}
                            className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700"
                        >
                            <h3 className="font-bold text-slate-900 dark:text-white mb-2">{path.name}</h3>
                            <div className="mb-4">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        {path.progress}%
                                    </span>
                                    <span className="text-xs text-slate-500">
                                        {path.completedCourses}/{path.courses} courses
                                    </span>
                                </div>
                                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full bg-${path.color}-600 transition-all`}
                                        style={{ width: `${path.progress}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Recent Activity */}
            <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
                    Recent Activity
                </h2>
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
                    {RECENT_ACTIVITY.map((activity) => (
                        <div key={activity.id} className="p-4 flex items-center gap-4">
                            <div
                                className={`w-10 h-10 rounded-lg flex items-center justify-center ${activity.type === "lesson"
                                        ? "bg-blue-100 dark:bg-blue-900/30"
                                        : activity.type === "quiz"
                                            ? "bg-purple-100 dark:bg-purple-900/30"
                                            : "bg-yellow-100 dark:bg-yellow-900/30"
                                    }`}
                            >
                                {activity.type === "lesson" && <BookOpen className="w-5 h-5 text-blue-600" />}
                                {activity.type === "quiz" && <Target className="w-5 h-5 text-purple-600" />}
                                {activity.type === "certificate" && <Award className="w-5 h-5 text-yellow-600" />}
                            </div>
                            <div className="flex-1">
                                <p className="font-semibold text-slate-900 dark:text-white">{activity.title}</p>
                                <p className="text-sm text-slate-600 dark:text-slate-400">{activity.course}</p>
                            </div>
                            <div className="text-right">
                                {activity.completed && (
                                    <CheckCircle className="w-5 h-5 text-green-600 ml-auto mb-1" />
                                )}
                                {activity.score && (
                                    <p className="text-sm font-semibold text-blue-600 mb-1">Score: {activity.score}%</p>
                                )}
                                <p className="text-xs text-slate-500">{activity.date}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
