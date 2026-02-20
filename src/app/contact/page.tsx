"use client";

import { Mail, MapPin, Phone, Send, MessageCircle } from "lucide-react";
import { logger } from '@/lib/logger';
import { useState } from "react";
import { COMPANY_INFO } from "@/lib/constants";
import { toast } from "sonner";

export default function ContactPage() {
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        subject: "",
        message: "",
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const response = await fetch("/api/contact", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(formData),
            });

            const data = await response.json();

            if (response.ok && data.success) {
                toast.success("Message sent successfully! We'll get back to you soon.");
                // Reset form
                setFormData({ name: "", email: "", subject: "", message: "" });
            } else {
                toast.error(data.error || "Failed to send message. Please try again.");
            }
        } catch (error) {
            logger.error("Contact form error:", error);
            toast.error("Failed to send message. Please email us directly at info@easysalesexport.com");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <section className="bg-primary text-white py-20">
                <div className="max-w-7xl mx-auto px-4 text-center">
                    <h1 className="text-4xl md:text-5xl font-bold mb-4">Contact Us</h1>
                    <p className="text-xl text-white/90 max-w-2xl mx-auto">
                        Get in touch with Easy Sales Export for any inquiries about our platform and services
                    </p>
                </div>
            </section>

            {/* Contact Information & Form */}
            <section className="py-20">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                        {/* Contact Information */}
                        <div>
                            <h2 className="text-3xl font-bold text-slate-900 mb-6">
                                Get In Touch
                            </h2>
                            <p className="text-lg text-slate-600 mb-8">
                                We're here to help! Reach out to us through any of the following channels:
                            </p>

                            <div className="space-y-6">
                                {/* Email */}
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                                        <Mail className="w-6 h-6 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-slate-900 mb-1">
                                            Email
                                        </h3>
                                        <a
                                            href={`mailto:${COMPANY_INFO.contact.cooperative.email}`}
                                            className="text-primary hover:underline"
                                        >
                                            {COMPANY_INFO.contact.cooperative.email}
                                        </a>
                                    </div>
                                </div>

                                {/* Phone */}
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                                        <Phone className="w-6 h-6 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-slate-900 mb-1">
                                            Phone
                                        </h3>
                                        <a
                                            href={`tel:${COMPANY_INFO.contact.general.phone}`}
                                            className="text-primary hover:underline"
                                        >
                                            {COMPANY_INFO.contact.general.phone}
                                        </a>
                                    </div>
                                </div>

                                {/* WhatsApp */}
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                                        <MessageCircle className="w-6 h-6 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-slate-900 mb-1">
                                            WhatsApp
                                        </h3>
                                        <a
                                            href={`https://wa.me/${COMPANY_INFO.contact.general.whatsapp}`}
                                            className="text-primary hover:underline"
                                        >
                                            {COMPANY_INFO.contact.general.whatsapp}
                                        </a>
                                    </div>
                                </div>

                                {/* Address */}
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                                        <MapPin className="w-6 h-6 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-slate-900 mb-1">
                                            Address
                                        </h3>
                                        <p className="text-slate-600">
                                            {COMPANY_INFO.contact.cooperative.address}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Office Hours */}
                            <div className="mt-8 p-6 bg-white rounded-xl shadow-lg">
                                <h3 className="font-bold text-slate-900 mb-4">
                                    Office Hours
                                </h3>
                                <div className="space-y-2 text-slate-600">
                                    <p>Monday - Friday: 8:00 AM - 5:00 PM</p>
                                    <p>Saturday: 9:00 AM - 2:00 PM</p>
                                    <p>Sunday: Closed</p>
                                </div>
                            </div>
                        </div>

                        {/* Contact Form */}
                        <div className="bg-white rounded-2xl shadow-xl p-8">
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">
                                Send Us a Message
                            </h2>
                            <form onSubmit={handleSubmit} className="space-y-6">
                                {/* Name */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-900 mb-2">
                                        Name
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white text-slate-900"
                                        required
                                    />
                                </div>

                                {/* Email */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-900 mb-2">
                                        Email
                                    </label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white text-slate-900"
                                        required
                                    />
                                </div>

                                {/* Subject */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-900 mb-2">
                                        Subject
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.subject}
                                        onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white text-slate-900"
                                        required
                                    />
                                </div>

                                {/* Message */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-900 mb-2">
                                        Message
                                    </label>
                                    <textarea
                                        value={formData.message}
                                        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                                        rows={6}
                                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white text-slate-900 resize-none"
                                        required
                                    />
                                </div>

                                {/* Submit Button */}
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="w-full inline-flex items-center justify-center gap-2 px-8 py-4 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Send className="w-5 h-5" />
                                    {isSubmitting ? "Sending..." : "Send Message"}
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </section>

            {/* Tagline */}
            <section className="py-12 bg-white">
                <div className="max-w-7xl mx-auto px-4 text-center">
                    <p className="text-lg font-medium text-slate-600">
                        Powering Nigeria's Agro Trade, Export & Farm Investment
                    </p>
                </div>
            </section>
        </div>
    );
}
