import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: "class", // Enable class-based dark mode
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: "#2E519F",
                accent: "#E31E24",
            },
        },
    },
    plugins: [],
};

export default config;
