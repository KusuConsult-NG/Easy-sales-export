# AI Sidebar Integration Guide

## Overview
The AI Sidebar provides GPT-4 powered assistance with context-aware responses based on the user's current page and role.

## Environment Setup

Add to your `.env.local`:
```bash
OPENAI_API_KEY=sk-your-openai-api-key-here
```

Get your API key from [OpenAI Platform](https://platform.openai.com/)

## Usage

### 1. Import the component
```tsx
import { AISidebar } from "@/components/ai/AISidebar";
```

### 2. Add to your layout or page
```tsx
export default function YourPage() {
  return (
    <div>
      {/* Your page content */}
      
      {/* AI Sidebar - floats in bottom-right */}
      <AISidebar userRole={session?.user?.role} />
    </div>
  );
}
```

### 3. Global Integration (Recommended)
Add to `src/app/layout.tsx` to make it available on all pages:

```tsx
import { AISidebar } from "@/components/ai/AISidebar";
import { auth } from "@/lib/auth";

export default async function RootLayout({ children }) {
  const session = await auth();
  
  return (
    <html>
      <body>
        {children}
        <AISidebar userRole={session?.user?.role} />
      </body>
    </html>
  );
}
```

## Features

- **Context-Aware**: Provides suggestions based on current page (/farm-nation, /marketplace, /loans, etc.)
- **Role-Based**: Adapts responses for admin, seller, or regular users
- **Chat History**: Persists conversation in Firestore
- **Smooth Animations**: Sliding drawer with framer-motion
- **Mobile Responsive**: Works on all screen sizes
- **Keyboard Shortcuts**: Enter to send, Shift+Enter for new line

## Server Actions

All chat interactions are logged and can be audited:
- `sendAIMessage()` - Send message and get GPT-4 response
- `getAIChatHistory()` - Retrieve past conversations
- `getAISuggestions()` - Get contextual quick questions
