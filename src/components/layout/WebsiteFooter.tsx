import Link from "next/link";
import { Facebook, Twitter, Instagram, Linkedin, Mail, Phone, MapPin, MessageCircle } from "lucide-react";
import { COMPANY_INFO } from "@/lib/constants";

export default function WebsiteFooter() {
    const footerLinks = {
        platform: [
            { name: "Export Windows", href: "/export" },
            { name: "Marketplace", href: "/marketplace" },
            { name: "Cooperatives", href: "/cooperatives" },
            { name: "WAVE Program", href: "/wave" },
        ],
        resources: [
            { name: "Academy", href: "/academy" },
            { name: "Farm Nation", href: "/farm-nation" },
            { name: "About Us", href: "/about" },
            { name: "Contact", href: "/contact" },
        ],
        legal: [
            { name: "Terms of Service", href: "/terms" },
            { name: "Privacy Policy", href: "/privacy" },
            { name: "Security", href: "/security" },
            { name: "FAQ", href: "/faq" },
        ],
    };

    return (
        <footer className="bg-slate-900 text-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12">
                    {/* Brand */}
                    <div className="lg:col-span-2">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 bg-linear-to-br from-orange-500 to-amber-600 rounded-xl flex items-center justify-center shadow-lg">
                                <span className="text-white font-bold text-xl">ES</span>
                            </div>
                            <div>
                                <div className="text-lg font-bold">Easy Sales Export</div>
                                <div className="text-sm text-slate-400">Agricultural Export Platform</div>
                            </div>
                        </div>
                        <p className="text-slate-400 mb-6 max-w-sm">
                            Empowering Nigerian farmers and investors through verified agricultural export opportunities, cooperative savings, and marketplace trading.
                        </p>
                        <div className="flex gap-4">
                            <a href="#" className="w-10 h-10 bg-slate-800 hover:bg-orange-600 rounded-lg flex items-center justify-center transition-colors">
                                <Facebook className="w-5 h-5" />
                            </a>
                            <a href="#" className="w-10 h-10 bg-slate-800 hover:bg-orange-600 rounded-lg flex items-center justify-center transition-colors">
                                <Twitter className="w-5 h-5" />
                            </a>
                            <a href="#" className="w-10 h-10 bg-slate-800 hover:bg-orange-600 rounded-lg flex items-center justify-center transition-colors">
                                <Instagram className="w-5 h-5" />
                            </a>
                            <a href="#" className="w-10 h-10 bg-slate-800 hover:bg-orange-600 rounded-lg flex items-center justify-center transition-colors">
                                <Linkedin className="w-5 h-5" />
                            </a>
                        </div>
                    </div>

                    {/* Platform Links */}
                    <div>
                        <h3 className="text-lg font-semibold mb-4">Platform</h3>
                        <ul className="space-y-3">
                            {footerLinks.platform.map((link) => (
                                <li key={link.name}>
                                    <Link href={link.href} className="text-slate-400 hover:text-orange-400 transition-colors">
                                        {link.name}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Resources Links */}
                    <div>
                        <h3 className="text-lg font-semibold mb-4">Resources</h3>
                        <ul className="space-y-3">
                            {footerLinks.resources.map((link) => (
                                <li key={link.name}>
                                    <Link href={link.href} className="text-slate-400 hover:text-orange-400 transition-colors">
                                        {link.name}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Legal Links */}
                    <div>
                        <h3 className="text-lg font-semibold mb-4">Legal</h3>
                        <ul className="space-y-3">
                            {footerLinks.legal.map((link) => (
                                <li key={link.name}>
                                    <Link href={link.href} className="text-slate-400 hover:text-orange-400 transition-colors">
                                        {link.name}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                {/* Bottom Bar */}
                <div className="mt-12 pt-8 border-t border-slate-800">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                        <p className="text-slate-400 text-sm">
                            © {new Date().getFullYear()} Easy Sales Export. All rights reserved.
                        </p>
                        <div className="flex flex-wrap gap-6 text-sm text-slate-400">
                            <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4" />
                                <span>info@easysalesexport.com</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Phone className="w-4 h-4" />
                                <span>{COMPANY_INFO.contact.general.phone}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <MessageCircle className="w-4 h-4" />
                                <span>{COMPANY_INFO.contact.general.whatsapp} (WhatsApp)</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
}
