"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";

const slides = [
    {
        id: 1,
        image: "/images/hero-1.jpg",
        title: "Export Windows",
        description: "Invest in verified agricultural export contracts with 18-22% returns"
    },
    {
        id: 2,
        image: "/images/hero-2.jpg",
        title: "Cooperatives",
        description: "Join 35,000+ farmers in savings and loan programs"
    },
    {
        id: 3,
        image: "/images/hero-3.jpg",
        title: "WAVE Program",
        description: "Empowering 15,000+ women farmers across Nigeria"
    }
];

export default function HeroSlider() {
    const [currentSlide, setCurrentSlide] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);

    useEffect(() => {
        if (!isAutoPlaying) return;

        const interval = setInterval(() => {
            setCurrentSlide((prev) => (prev + 1) % slides.length);
        }, 5000);

        return () => clearInterval(interval);
    }, [isAutoPlaying]);

    const goToSlide = (index: number) => {
        setCurrentSlide(index);
        setIsAutoPlaying(false);
    };

    const nextSlide = () => {
        setCurrentSlide((prev) => (prev + 1) % slides.length);
        setIsAutoPlaying(false);
    };

    const prevSlide = () => {
        setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
        setIsAutoPlaying(false);
    };

    return (
        <div className="relative w-full h-full rounded-3xl overflow-hidden group">
            {/* Slides */}
            <div className="relative w-full h-full">
                {slides.map((slide, index) => (
                    <div
                        key={slide.id}
                        className={`absolute inset-0 transition-opacity duration-700 ${index === currentSlide ? "opacity-100" : "opacity-0"
                            }`}
                    >
                        {/* Background Image */}
                        <Image
                            src={slide.image}
                            alt={slide.title}
                            fill
                            className="object-cover"
                            priority={index === 0}
                        />

                        {/* Overlay */}
                        <div className="absolute inset-0 bg-linear-to-t from-slate-900/80 via-slate-900/40 to-transparent" />

                        {/* Content */}
                        <div className="absolute bottom-0 left-0 right-0 p-8 text-white">
                            <h3 className="text-3xl font-bold mb-2">{slide.title}</h3>
                            <p className="text-lg text-white/90">{slide.description}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Navigation Arrows */}
            <button
                onClick={prevSlide}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
            >
                <ChevronLeft className="w-6 h-6 text-white" />
            </button>
            <button
                onClick={nextSlide}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
            >
                <ChevronRight className="w-6 h-6 text-white" />
            </button>

            {/* Dots Indicator */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                {slides.map((_, index) => (
                    <button
                        key={index}
                        onClick={() => goToSlide(index)}
                        className={`w-2 h-2 rounded-full transition-all ${index === currentSlide
                            ? "bg-white w-8"
                            : "bg-white/50 hover:bg-white/75"
                            }`}
                    />
                ))}
            </div>
        </div>
    );
}
