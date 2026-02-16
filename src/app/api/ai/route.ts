
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

// Fallback rules if AI fails or key missing
const RULES = [
    { keywords: ["export", "window"], response: "To view current export opportunities, visit the 'Export Windows' section in your dashboard. You can invest in ongoing windows." },
    { keywords: ["marketplace", "buy", "order"], response: "You can browse verified agricultural products in our Marketplace. Payments are secured via Escrow." },
    { keywords: ["academy", "course", "learn"], response: "The Easy Academy offers courses on export guidelines. Visit the Academy tab to enroll." },
    { keywords: ["escrow", "payment", "safe"], response: "We use an Escrow system to protect your funds. Payments are held until you confirm receipt of your order." },
    { keywords: ["register", "signup", "join"], response: "You can register as a Buyer, Seller, or Cooperative Member. Click 'Get Started' on the homepage." },
];

const SYSTEM_PROMPT = `
You are the "Easy Sales Assistant", a helpful AI support agent for "Easy Sales Export", an agricultural export platform in Nigeria.
Your goal is to help users (Buyers, Sellers, Cooperative Members) navigate the platform.

Context:
- Platform: Easy Sales Export (facilitates agricultural exports, marketplace, and education).
- Features:
  - Export Windows: Investment opportunities in export cycles (e.g., Ginger, Cashew). Admin managed.
  - Marketplace: Buy/Sell agricultural products. Payments secured by Escrow.
  - Academy: Learn export guidelines and get certified.
  - Cooperatives: Join for financial support (loans, savings) and resource pooling.
  - Farm Nation: For land owners and investors to partner.
- Tone: Professional, helpful, concise, and friendly.

Guidelines:
- If asked about "how to", give step-by-step instructions.
- If asked about "prices", say "Please check the Marketplace for real-time prices."
- If asked about "support", direct them to the 'Contact' page or 'Messages'.
- Keep answers under 3 sentences unless detailed steps are needed.
`;

export async function POST(req: Request) {
    try {
        const { message } = await req.json();

        if (!message) {
            return NextResponse.json({ error: "Message required" }, { status: 400 });
        }

        const userMessage = message.toLowerCase();

        // 1. Check for valid API Key
        const apiKey = process.env.GEMINI_API_KEY;

        if (apiKey) {
            try {
                // Call Gemini API (REST) to avoid adding heavyweight SDK
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        contents: [
                            {
                                role: "user",
                                parts: [{ text: SYSTEM_PROMPT + "\n\nUser Question: " + message }]
                            }
                        ],
                        generationConfig: {
                            temperature: 0.7,
                            maxOutputTokens: 150,
                        }
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;

                    if (reply) {
                        return NextResponse.json({ reply });
                    }
                } else {
                    logger.error("Gemini API Error:", await response.text());
                    // Fallthrough to rules
                }

            } catch (apiError) {
                logger.error("Gemini Request Failed:", apiError);
                // Fallthrough to rules
            }
        } else {
            logger.warn("GEMINI_API_KEY not found, using fallback rules.");
        }

        // 2. Rules-based Logic (Fallback)
        let reply = "I'm having trouble connecting to my brain right now, but I can help with basics. You can ask about Exports, Marketplace, or the Academy.";

        for (const rule of RULES) {
            if (rule.keywords.some(k => userMessage.includes(k))) {
                reply = rule.response;
                break;
            }
        }

        return NextResponse.json({ reply });

    } catch (error: any) {
        logger.error("AI Route Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
