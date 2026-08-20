"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { 
    Search, 
    BookOpen, 
    Clock, 
    Lock, 
    Loader2, 
    ChevronRight, 
    Play, 
    Sparkles, 
    GraduationCap,
    SlidersHorizontal,
    Compass
} from "lucide-react";
import Link from "next/link";
import { getCoursesAction, getEnrolledCoursesWithDetailsAction, type Course } from "@/app/actions/academy";
import { useToast } from "@/contexts/ToastContext";
import BackButton from "@/components/ui/BackButton";
import { checkCourseAccess, normaliseAcademyPlan, ACADEMY_TIERS_OPENED } from "@/lib/academy-plan";



export default function CourseCatalogPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const { showToast } = useToast();

    const [courses, setCourses] = useState<Course[]>([]);
    const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());
    
    const [loading, setLoading] = useState(true);

    // Filter and Search States
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedLevel, setSelectedLevel] = useState<string>("all");
    const [selectedTier, setSelectedTier] = useState<string>("all");
    const [sortBy, setSortBy] = useState<string>("newest");

    const userPlan = (session?.user as any)?.serviceRegistrations?.academy?.plan || "free";

    /**
     * The plan, read through the same normaliser the access rule uses.
     *
     * Everything below that describes the learner's access used to be decided
     * by raw string equality on `userPlan` — `userPlan === "elite"`, and a
     * nested ternary for the rest — while `checkCourseAccess` beside it
     * lower-cases, trims and maps the legacy "advanced" onto "standard". The
     * catalogue's own test asserts that `checkCourseAccess(" Elite ", "elite")`
     * is true, so a learner whose stored plan carried a stray capital or space
     * was shown every elite course, told their access was "Free, Foundation &
     * Standard", and offered an Upgrade Plan button for the tier they had
     * already bought. `null` is its own answer: registered, no tier bought.
     */
    const plan = normaliseAcademyPlan(userPlan);
    const paidTiersOpened = plan ? ACADEMY_TIERS_OPENED[plan] : [];

    // Load initial data
    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);

    async function loadData() {
        setLoading(true);
        try {
            // Fetch courses
            const coursesRes = await getCoursesAction(48);
            if (coursesRes.success && coursesRes.data) {
                setCourses(coursesRes.data);
            } else {
                showToast(coursesRes.error || "Failed to retrieve courses catalog", "error");
            }

            // Fetch user's enrollments
            const enrollRes = await getEnrolledCoursesWithDetailsAction();
            if (enrollRes.success && enrollRes.data?.courses) {
                const ids = new Set<string>(
                    enrollRes.data.courses.map((c: any) => c.courseId)
                );
                setEnrolledIds(ids);
            }
        } catch (error) {
            console.error("Failed to load catalog data:", error);
            showToast("An unexpected error occurred while loading courses", "error");
        } finally {
            setLoading(false);
        }
    }


    // Filter and Sort Processing
    const filteredCourses = courses.filter((course) => {
        const matchesSearch = 
            course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            course.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
            course.instructor.toLowerCase().includes(searchQuery.toLowerCase());

        const matchesLevel = selectedLevel === "all" || course.level === selectedLevel;
        const matchesTier = selectedTier === "all" || (course.tier || "free") === selectedTier;

        /**
         * THE CATALOGUE DELETED EVERY COURSE IT WAS SUPPOSED TO PADLOCK.
         *
         * This predicate ended `&& checkCourseAccess(userPlan, course.tier)`,
         * under the comment "Only show courses that are accessible under the
         * user's active tier" — so a course the learner's plan does not open
         * never reached the grid at all.
         *
         * The card below then branches on the SAME call with the SAME
         * arguments, and one arm of it is a padlock reading "Upgrade to
         * Unlock". A pure function cannot return false in the filter and true
         * in the render, so that arm was unreachable: the padlock this page is
         * named for could never be drawn.
         *
         * Three other places say plainly that it should be. lib/academy-plan.ts
         * lists this file as the copy that "decides which cards show a lock";
         * academy-course-access.test.ts repeats it; academy-content-gating.test.ts
         * says the padlock is drawn "on the card". And the server had already
         * done the work for it — getCoursesAction calls stripLockedContent,
         * which deliberately KEEPS the title, description, tier, level, duration
         * and module outline and removes only videoUrl, documentUrl, excelUrl
         * and lesson bodies. It builds a course record whose entire purpose is
         * to be shown locked; the browser threw it away.
         *
         * What that cost: a Foundation learner saw no Standard or Elite course
         * anywhere, so the catalogue could not sell the upgrade its own
         * "Upgrade Plan" button asks for. The Tier filter offers Standard and
         * Elite, and picking either returned "No Courses Match Your Criteria" —
         * indistinguishable from a catalogue that has none. And a learner who
         * had bought no tier saw only free courses, which is an empty page
         * whenever the academy publishes none.
         *
         * Access still decides what the card DOES, immediately below, and the
         * material itself was never in the browser to begin with.
         */
        return matchesSearch && matchesLevel && matchesTier;
    }).sort((a, b) => {
        if (sortBy === "a-z") {
            return a.title.localeCompare(b.title);
        }
        // Newest is default (createdAt desc)
        return 0; // Handled naturally by backend sorting, placeholder for frontend stability
    });

    /**
     * "Free & Foundation" — read off ACADEMY_TIERS_OPENED rather than spelled
     * out, so this sentence cannot drift from the rule that grants the access
     * it describes. Free is always included: a free tier is open to everybody.
     */
    function describeTiers(tiers: readonly string[]): string {
        const names = ["Free", ...tiers.map((t) => t.charAt(0).toUpperCase() + t.slice(1))];
        if (names.length === 1) return names[0];
        return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
    }

    // Helper to get tier configuration for UI styling
    function getTierConfig(tier?: string) {
        const t = (tier || "free").toLowerCase();
        switch (t) {
            case "elite":
                return {
                    name: "Elite",
                    badge: "bg-amber-100 text-amber-800 border-amber-200",
                    gradient: "from-amber-500 to-yellow-600",
                    glow: "shadow-amber-500/20 hover:shadow-amber-500/30",
                    text: "text-amber-600"
                };
            case "standard":
                return {
                    name: "Standard",
                    badge: "bg-purple-100 text-purple-800 border-purple-200",
                    gradient: "from-purple-500 to-indigo-600",
                    glow: "shadow-purple-500/20 hover:shadow-purple-500/30",
                    text: "text-purple-600"
                };
            case "foundation":
                return {
                    name: "Foundation",
                    badge: "bg-blue-100 text-blue-800 border-blue-200",
                    gradient: "from-blue-500 to-sky-600",
                    glow: "shadow-blue-500/20 hover:shadow-blue-500/30",
                    text: "text-blue-600"
                };
            default:
                return {
                    name: "Free",
                    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
                    gradient: "from-emerald-500 to-teal-600",
                    glow: "shadow-emerald-500/20 hover:shadow-emerald-500/30",
                    text: "text-emerald-600"
                };
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <Loader2 className="w-12 h-12 animate-spin text-blue-600 mb-4" />
                <p className="text-slate-600 font-semibold animate-pulse">Loading...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            
            {/* Navigation & Header */}
            <div>
                <BackButton fallbackPath="/academy/dashboard" />
                
                {/* Hero Section */}
                <div className="bg-linear-to-br from-slate-900 via-indigo-950 to-slate-950 rounded-3xl p-8 lg:p-12 shadow-2xl relative overflow-hidden mb-8 border border-indigo-500/20">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                    <div className="absolute bottom-0 left-1/4 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
                    
                    <div className="relative z-10 max-w-3xl">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 mb-4">
                            <Sparkles className="w-3.5 h-3.5" /> Academy Catalog
                        </span>
                        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight mb-4">
                            Master Your Export & Sales Skills
                        </h1>
                        <p className="text-slate-300 text-base sm:text-lg font-light leading-relaxed">
                            Unlock expert-guided training courses tailored to global commerce. Boost your shipping operations, learn village marketplace logistics, and perfect foreign buyer communications.
                        </p>
                    </div>
                </div>
            </div>

            {/* User Plan Context & Alert */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 shadow-xs">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0 border border-indigo-100">
                        <GraduationCap className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-slate-500">Your Learning Plan</p>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xl font-bold text-slate-900 capitalize">
                                {plan ?? "Free"} Tier
                            </span>
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                            <span className="text-sm text-slate-600">
                                {plan === "elite"
                                    ? "Unlimited access to all courses"
                                    : `Access to ${describeTiers(paidTiersOpened)} courses`}
                            </span>
                        </div>
                    </div>
                </div>
                {plan !== "elite" && (
                    <Link
                        href="/academy/application"
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-md hover:shadow-lg text-sm shrink-0"
                    >
                        Upgrade Plan
                        <ChevronRight className="w-4 h-4" />
                    </Link>
                )}
            </div>

            {/* Filter Panel */}
            <div className="bg-white/80 backdrop-blur-md border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
                <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
                    <SlidersHorizontal className="w-5 h-5 text-indigo-600" />
                    <h2 className="text-lg font-bold text-slate-900">Search & Filter Catalog</h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Search Input */}
                    <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                            <Search className="w-5 h-5 text-slate-400" />
                        </span>
                        <input
                            type="text"
                            placeholder="Search courses, instructors..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 text-sm shadow-xs"
                        />
                    </div>

                    {/* Difficulty filter */}
                    <div>
                        <select
                            value={selectedLevel}
                            onChange={(e) => setSelectedLevel(e.target.value)}
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-700 text-sm shadow-xs cursor-pointer"
                        >
                            <option value="all">All Difficulty Levels</option>
                            <option value="beginner">Beginner</option>
                            <option value="intermediate">Intermediate</option>
                            <option value="advanced">Advanced</option>
                        </select>
                    </div>

                    {/* Plan Tier filter */}
                    <div>
                        <select
                            value={selectedTier}
                            onChange={(e) => setSelectedTier(e.target.value)}
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-700 text-sm shadow-xs cursor-pointer"
                        >
                            <option value="all">All Tiers</option>
                            <option value="free">Free Tiers</option>
                            <option value="foundation">Foundation Tiers</option>
                            <option value="standard">Standard Tiers</option>
                            <option value="elite">Elite Tiers</option>
                        </select>
                    </div>

                    {/* Sort Options */}
                    <div>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-700 text-sm shadow-xs cursor-pointer"
                        >
                            <option value="newest">Sort by: Newest</option>
                            <option value="a-z">Sort by: A - Z</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Catalog Grid */}
            <div>
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-xl font-bold text-slate-900">
                        Available Courses ({filteredCourses.length})
                    </h3>
                    {(searchQuery || selectedLevel !== "all" || selectedTier !== "all") && (
                        <button
                            onClick={() => {
                                setSearchQuery("");
                                setSelectedLevel("all");
                                setSelectedTier("all");
                            }}
                            className="text-indigo-600 hover:text-indigo-700 text-sm font-semibold transition"
                        >
                            Clear All Filters
                        </button>
                    )}
                </div>

                {filteredCourses.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center shadow-xs">
                        <Compass className="w-16 h-16 text-slate-300 mx-auto mb-4 animate-pulse" />
                        <h4 className="text-lg font-bold text-slate-900 mb-1">No Courses Match Your Criteria</h4>
                        <p className="text-slate-600 text-sm mb-6 max-w-sm mx-auto">
                            Try loosening your search terms or checking a different difficulty level.
                        </p>
                        <button
                            onClick={() => {
                                setSearchQuery("");
                                setSelectedLevel("all");
                                setSelectedTier("all");
                            }}
                            className="px-5 py-2.5 bg-slate-950 text-white font-semibold rounded-xl text-sm hover:bg-slate-800 transition"
                        >
                            Reset Search Filters
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {filteredCourses.map((course) => {
                            const id = course.id!;
                            const isEnrolled = enrolledIds.has(id);
                            const hasAccess = checkCourseAccess(userPlan, course.tier || "free");
                            const tConfig = getTierConfig(course.tier);

                            return (
                                <div
                                    key={id}
                                    data-testid="course-card"
                                    className={`bg-white rounded-2xl overflow-hidden border border-slate-200 hover:shadow-xl transition-all duration-300 flex flex-col h-full group ${tConfig.glow}`}
                                >
                                    {/* Thumbnail Header */}
                                    <div className={`h-48 bg-linear-to-br ${tConfig.gradient} relative p-6 flex flex-col justify-between overflow-hidden shrink-0`}>
                                        {/* Radial subtle layout overlay */}
                                        <div className="absolute inset-0 bg-radial-gradient from-white/10 to-transparent pointer-events-none" />
                                        
                                        {/* Badges Container */}
                                        <div className="flex items-center justify-between z-10 relative">
                                            {/* Difficulty Badge */}
                                            <span className="px-3 py-1 bg-white/20 backdrop-blur-md border border-white/20 rounded-full text-white text-xs font-semibold uppercase tracking-wider">
                                                {course.level}
                                            </span>
                                            {/* Package Tier Badge */}
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold border capitalize ${tConfig.badge}`}>
                                                {tConfig.name} Tier
                                            </span>
                                        </div>

                                        {/* Graphic Overlay and Title placeholder */}
                                        <div className="flex items-center justify-center shrink-0 h-24">
                                            <GraduationCap className="w-16 h-16 text-white/30 group-hover:scale-110 transition-transform duration-300" />
                                        </div>
                                    </div>

                                    {/* Body Content */}
                                    <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
                                        <div className="space-y-2">
                                            <h4 className="text-xl font-bold text-slate-900 line-clamp-1 group-hover:text-indigo-600 transition-colors">
                                                {course.title}
                                            </h4>
                                            <p className="text-slate-600 text-sm leading-relaxed line-clamp-2">
                                                {course.description}
                                            </p>
                                        </div>

                                        {/* Course Stats */}
                                        <div className="grid grid-cols-2 gap-4 py-3 border-y border-slate-100 text-slate-600 text-sm">
                                            <div className="flex items-center gap-2">
                                                <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                                                <span className="truncate">{course.duration}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <BookOpen className="w-4 h-4 text-slate-400 shrink-0" />
                                                <span>{course.modules?.length ?? 0} modules</span>
                                            </div>
                                        </div>

                                        {/* Instructor & CTA Action Button */}
                                        <div className="space-y-4 pt-2">
                                            <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                                                <span>Instructor: {course.instructor}</span>
                                                {course.price > 0 && (
                                                    <span className="text-slate-900 font-bold text-sm">
                                                        ${course.price} Value
                                                    </span>
                                                )}
                                            </div>

                                            {/* Enrollment CTA Logic.
                                                Access is asked FIRST. `isEnrolled && !hasAccess`
                                                is a real state — enrolled under a plan that has
                                                since lapsed or changed — and "Resume Course" for
                                                it linked to /academy/{id}, which checks the same
                                                rule on load and pushes the learner to
                                                /academy/application. A button whose only outcome
                                                is a redirect to the upgrade page should be the
                                                upgrade button. */}
                                            {!hasAccess ? (
                                                <Link
                                                    href="/academy/application"
                                                    className="inline-flex items-center justify-center gap-2 w-full py-3 bg-slate-50 border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50/50 font-bold rounded-xl transition"
                                                >
                                                    <Lock className="w-4 h-4 shrink-0 text-slate-400 hover:text-rose-500" />
                                                    Upgrade to Unlock
                                                </Link>
                                            ) : isEnrolled ? (
                                                <Link
                                                    href={`/academy/${id}`}
                                                    className="inline-flex items-center justify-center gap-2 w-full py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl transition-all shadow-xs border border-indigo-200"
                                                >
                                                    <Play className="w-4 h-4 fill-indigo-700 text-indigo-700" />
                                                    Resume Course
                                                </Link>
                                            ) : (
                                                <Link
                                                    href={`/academy/${id}`}
                                                    className="inline-flex items-center justify-center gap-2 w-full py-3 bg-slate-950 hover:bg-slate-800 text-white font-bold rounded-xl transition shadow-md hover:shadow-lg"
                                                >
                                                    <Play className="w-4 h-4 fill-white text-white" />
                                                    Start Course
                                                </Link>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
