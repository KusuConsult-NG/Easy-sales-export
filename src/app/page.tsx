import Link from "next/link";
import Image from "next/image";
import {
    TrendingUp,
    Shield,
    Globe,
    Users,
    Package,
    Award,
    ArrowRight,
    CheckCircle,
    Heart,
    Leaf,
    GraduationCap,
    Home,
    DollarSign,
    Star,
} from "lucide-react";
import { COMPANY_INFO } from "@/lib/constants";
import ImageSlider from "@/components/ui/ImageSlider";

export default function LandingPage() {
    const services = [
        {
            icon: Package,
            title: "Export Windows",
            description:
                "Participate in collective export opportunities with escrow-protected payments. Pool resources with other farmers for larger contracts.",
            link: "/export",
            color: "bg-blue-500",
        },
        {
            icon: TrendingUp,
            title: "Marketplace",
            description:
                "Buy and sell premium agricultural commodities with quality guarantees and secure escrow payments for all transactions.",
            link: "/marketplace",
            color: "bg-green-500",
        },
        {
            icon: Users,
            title: "Cooperatives",
            description:
                "Join farming cooperatives to access group savings, collective bargaining, and shared resources for better profits.",
            link: "/cooperatives",
            color: "bg-purple-500",
        },
        {
            icon: Heart,
            title: "WAVE Program",
            description:
                "Women Agripreneurs Value-creation Empowerment program providing funding, training, and mentorship for women farmers.",
            link: "/wave",
            color: "bg-pink-500",
        },
        {
            icon: Home,
            title: "Farm Nation",
            description:
                "Invest in agricultural land or find farmland for lease. Build long-term wealth through agricultural real estate.",
            link: "/farm-nation",
            color: "bg-orange-500",
        },
        {
            icon: GraduationCap,
            title: "Academy",
            description:
                "Learn modern farming techniques, export regulations, and business management from industry experts.",
            link: "/academy",
            color: "bg-indigo-500",
        },
    ];

    const features = [
        {
            icon: Shield,
            title: "Escrow Protection",
            description:
                "Your payments are protected in escrow until delivery is confirmed",
        },
        {
            icon: Globe,
            title: "Global Markets",
            description:
                "Access international buyers and export opportunities worldwide",
        },
        {
            icon: Users,
            title: "Cooperative Savings",
            description:
                "Join our cooperative and benefit from collective bargaining power",
        },
        {
            icon: Award,
            title: "Quality Assurance",
            description:
                "All products meet international export standards and certifications",
        },
    ];

    const howItWorks = [
        {
            step: "1",
            title: "Create Account",
            description:
                "Sign up for free and complete your farmer or buyer profile with verification documents.",
        },
        {
            step: "2",
            title: "Choose Service",
            description:
                "Browse export windows, marketplace products, cooperatives, or learning programs.",
        },
        {
            step: "3",
            title: "Make Transaction",
            description:
                "Participate in exports, buy/sell products, or join programs with secure escrow payments.",
        },
        {
            step: "4",
            title: "Track & Earn",
            description:
                "Monitor your investments, deliveries, and earnings through your dashboard.",
        },
    ];

    const testimonials = [
        {
            name: "Amina Mohammed",
            role: "Yam Exporter, Plateau State",
            quote:
                "Easy Sales Export helped me connect with international buyers I never thought I could reach. My income has tripled in one year!",
            avatar: "👩🏾‍🌾",
        },
        {
            name: "Chukwudi Okafor",
            role: "Cooperative Leader, Enugu",
            quote:
                "The cooperative savings feature has empowered our members to invest in better equipment and expand our farming operations.",
            avatar: "👨🏿‍🌾",
        },
        {
            name: "Fatima Bello",
            role: "WAVE Program Beneficiary",
            quote:
                "The WAVE program gave me access to funding and training. I now run a successful sesame export business employing 15 women.",
            avatar: "👩🏾",
        },
    ];

    const stats = [
        { value: "1,200+", label: "Active Exporters" },
        { value: "₦2.5B+", label: "Total Exports" },
        { value: "24", label: "States Covered" },
        { value: "98%", label: "Success Rate" },
    ];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
            {/* Hero Section */}
            <section className="relative bg-linear-to-br from-primary via-blue-600 to-indigo-700 text-white overflow-hidden">
                <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
                <div className="relative max-w-7xl mx-auto px-4 py-20 lg:py-32">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                        <div className="animate-[slideInUp_0.8s_ease-out]">
                            <div className="flex items-center gap-3 mb-6">
                                <Image
                                    src="/images/logo.jpg"
                                    alt={COMPANY_INFO.name}
                                    width={64}
                                    height={64}
                                    className="w-16 h-16 rounded-2xl border-2 border-white/20"
                                />
                                <div>
                                    <h2 className="text-xl font-bold">{COMPANY_INFO.name}</h2>
                                    <p className="text-sm text-blue-100">
                                        {COMPANY_INFO.tagline}
                                    </p>
                                </div>
                            </div>
                            <h1 className="text-4xl lg:text-6xl font-bold mb-6 leading-tight">
                                Nigeria's Leading Agricultural Export Platform
                            </h1>
                            <p className="text-xl text-blue-100 mb-8">
                                Connecting Nigerian farmers to global markets with secure
                                payments, cooperative benefits, training programs, and
                                investment opportunities. Join thousands of farmers growing
                                their agribusiness.
                            </p>
                            <div className="flex flex-wrap gap-4">
                                <Link
                                    href="/auth/register"
                                    className="px-8 py-4 bg-white text-primary font-bold rounded-xl hover:scale-105 transition-transform elevation-3 flex items-center gap-2"
                                >
                                    Get Started Free
                                    <ArrowRight className="w-5 h-5" />
                                </Link>
                                <Link
                                    href="/auth/login"
                                    className="px-8 py-4 border-2 border-white text-white font-bold rounded-xl hover:bg-white/10 transition-colors"
                                >
                                    Sign In
                                </Link>
                            </div>
                        </div>
                        <div className="hidden lg:block animate-[fadeIn_1s_ease-out]">
                            <div className="relative h-[400px]">
                                <div className="absolute inset-0 bg-linear-to-br from-white/20 to-transparent rounded-3xl blur-3xl" />
                                <ImageSlider
                                    className="relative h-full"
                                    images={[
                                        {
                                            src: "/images/platform/dashboard.png",
                                            alt: "Easy Sales Export Dashboard",
                                            caption: "Track your exports and earnings in real-time",
                                        },
                                        {
                                            src: "/images/platform/marketplace.png",
                                            alt: "Agricultural Marketplace",
                                            caption: "Global marketplace for Nigerian agricultural products",
                                        },
                                        {
                                            src: "/images/platform/yam-tubers.png",
                                            alt: "Premium Yam Tubers for Export",
                                            caption: "Premium yam tubers ready for export",
                                        },
                                        {
                                            src: "/images/platform/sesame-seeds.png",
                                            alt: "High-Quality Sesame Seeds",
                                            caption: "High-quality sesame seeds for international markets",
                                        },
                                        {
                                            src: "/images/platform/hibiscus-flowers.png",
                                            alt: "Dried Hibiscus Flowers",
                                            caption: "Premium dried hibiscus flowers (Zobo)",
                                        },
                                    ]}
                                    autoPlayInterval={4000}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Stats Section */}
            <section className="py-16 border-b border-slate-200 dark:border-slate-800">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
                        {stats.map((stat, index) => (
                            <div
                                key={index}
                                className="text-center animate-[slideInUp_0.6s_ease-out]"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                <p className="text-4xl font-bold text-primary mb-2">
                                    {stat.value}
                                </p>
                                <p className="text-slate-600 dark:text-slate-400">
                                    {stat.label}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* About Section */}
            <section className="py-20 bg-white dark:bg-slate-900">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="max-w-3xl mx-auto text-center mb-16">
                        <h2 className="text-3xl lg:text-5xl font-bold text-slate-900 dark:text-white mb-6">
                            About Easy Sales Export
                        </h2>
                        <p className="text-lg text-slate-600 dark:text-slate-400 leading-relaxed">
                            We are Nigeria's premier agricultural export platform, dedicated
                            to connecting smallholder farmers with international markets
                            through innovative technology and secure financial systems. Our
                            mission is to empower Nigerian farmers to achieve financial
                            independence through sustainable agricultural practices and global
                            trade opportunities.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-8">
                            <Leaf className="w-12 h-12 text-green-600 mb-4" />
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                Our Vision
                            </h3>
                            <p className="text-slate-600 dark:text-slate-400">
                                To become Africa's leading agricultural export platform,
                                transforming the lives of millions of farmers through technology,
                                education, and fair trade practices.
                            </p>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-8">
                            <DollarSign className="w-12 h-12 text-primary mb-4" />
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
                                Our Impact
                            </h3>
                            <p className="text-slate-600 dark:text-slate-400">
                                Since 2020, we've facilitated over ₦2.5 billion in agricultural
                                exports, helping 1,200+ farmers increase their income by an
                                average of 65% through direct access to international markets.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Services Section */}
            <section className="py-20">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl lg:text-5xl font-bold text-slate-900 dark:text-white mb-4">
                            Our Services
                        </h2>
                        <p className="text-xl text-slate-600 dark:text-slate-400">
                            Comprehensive solutions for modern agricultural business
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {services.map((service, index) => (
                            <Link
                                key={index}
                                href={service.link}
                                className="group bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 hover-lift animate-[slideInUp_0.6s_ease-out]"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                <div
                                    className={`w-12 h-12 rounded-xl ${service.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}
                                >
                                    <service.icon className="w-6 h-6 text-white" />
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                    {service.title}
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                                    {service.description}
                                </p>
                                <span className="text-primary font-semibold flex items-center gap-2 group-hover:gap-3 transition-all">
                                    Learn More <ArrowRight className="w-4 h-4" />
                                </span>
                            </Link>
                        ))}
                    </div>
                </div>
            </section>

            {/* How It Works */}
            <section className="py-20 bg-white dark:bg-slate-900">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl lg:text-5xl font-bold text-slate-900 dark:text-white mb-4">
                            How It Works
                        </h2>
                        <p className="text-xl text-slate-600 dark:text-slate-400">
                            Getting started is easy
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                        {howItWorks.map((item, index) => (
                            <div
                                key={index}
                                className="text-center animate-[slideInUp_0.6s_ease-out]"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                <div className="w-16 h-16 rounded-full bg-primary text-white text-2xl font-bold flex items-center justify-center mx-auto mb-4">
                                    {item.step}
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                                    {item.title}
                                </h3>
                                <p className="text-slate-600 dark:text-slate-400">
                                    {item.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="py-20">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl lg:text-5xl font-bold text-slate-900 dark:text-white mb-4">
                            Why Choose Easy Sales Export?
                        </h2>
                        <p className="text-xl text-slate-600 dark:text-slate-400">
                            Everything you need to succeed in agricultural exports
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                        {features.map((feature, index) => (
                            <div
                                key={index}
                                className="bg-white dark:bg-slate-800 rounded-2xl p-6 elevation-2 hover-lift animate-[slideInUp_0.6s_ease-out]"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                                    <feature.icon className="w-6 h-6 text-primary" />
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                    {feature.title}
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                    {feature.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Testimonials Section */}
            <section className="py-20 bg-white dark:bg-slate-900">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl lg:text-5xl font-bold text-slate-900 dark:text-white mb-4">
                            Success Stories
                        </h2>
                        <p className="text-xl text-slate-600 dark:text-slate-400">
                            Hear from our community of successful farmers
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {testimonials.map((testimonial, index) => (
                            <div
                                key={index}
                                className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-8 animate-[slideInUp_0.6s_ease-out]"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                <div className="flex items-center gap-1 mb-4">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <Star
                                            key={star}
                                            className="w-5 h-5 fill-yellow-400 text-yellow-400"
                                        />
                                    ))}
                                </div>
                                <p className="text-slate-600 dark:text-slate-400 mb-6 italic">
                                    "{testimonial.quote}"
                                </p>
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl">
                                        {testimonial.avatar}
                                    </div>
                                    <div>
                                        <p className="font-bold text-slate-900 dark:text-white">
                                            {testimonial.name}
                                        </p>
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            {testimonial.role}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-20 bg-linear-to-br from-primary to-blue-700">
                <div className="max-w-4xl mx-auto px-4 text-center">
                    <Award className="w-16 h-16 text-white mx-auto mb-6" />
                    <h2 className="text-3xl lg:text-5xl font-bold text-white mb-6">
                        Ready to Transform Your Agricultural Business?
                    </h2>
                    <p className="text-xl text-blue-100 mb-8">
                        Join thousands of Nigerian farmers and exporters growing their
                        business with Easy Sales Export. Start your journey today!
                    </p>
                    <Link
                        href="/auth/register"
                        className="inline-flex items-center gap-2 px-8 py-4 bg-white text-primary font-bold rounded-xl hover:scale-105 transition-transform elevation-3"
                    >
                        Create Free Account
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer className="bg-slate-900 text-slate-400 py-12">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
                        <div>
                            <h3 className="text-white font-bold mb-4">
                                {COMPANY_INFO.name}
                            </h3>
                            <p className="text-sm">{COMPANY_INFO.fullName}</p>
                            <p className="text-sm">{COMPANY_INFO.rc}</p>
                        </div>
                        <div>
                            <h4 className="text-white font-semibold mb-4">Platform</h4>
                            <ul className="space-y-2 text-sm">
                                <li>
                                    <Link href="/marketplace" className="hover:text-white">
                                        Marketplace
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/export" className="hover:text-white">
                                        Export Windows
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/cooperatives" className="hover:text-white">
                                        Cooperatives
                                    </Link>
                                </li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="text-white font-semibold mb-4">Programs</h4>
                            <ul className="space-y-2 text-sm">
                                <li>
                                    <Link href="/wave" className="hover:text-white">
                                        WAVE Program
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/farm-nation" className="hover:text-white">
                                        Farm Nation
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/academy" className="hover:text-white">
                                        Academy
                                    </Link>
                                </li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="text-white font-semibold mb-4">Legal</h4>
                            <ul className="space-y-2 text-sm">
                                <li>
                                    <Link href="/terms" className="hover:text-white">
                                        Terms & Conditions
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/privacy" className="hover:text-white">
                                        Privacy Policy
                                    </Link>
                                </li>
                                <li>
                                    <Link href="/contact" className="hover:text-white">
                                        Contact Us
                                    </Link>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div className="border-t border-slate-800 pt-8 text-center text-sm">
                        <p>{COMPANY_INFO.copyright}</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
