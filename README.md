# Easy Sales Export Platform

> **Multi-Module Export, Agriculture, Education & Finance Platform** 

A comprehensive Next.js 16 platform connecting Nigerian exporters, farmers, learners, and cooperatives with global opportunities, microfinance services, and agricultural resources.

![Platform Completion: 90%+](https://img.shields.io/badge/Completion-90%25-brightgreen)
![Next.js 16](https://img.shields.io/badge/Next.js-16.1.6-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Firebase](https://img.shields.io/badge/Firebase-Admin-orange)

---

## 🌟 Platform Modules

### 1. **Export Windows** 🌍
Export opportunity aggregator connecting Nigerian businesses with global markets.
- Browse export opportunities by product category
- Filter by destination country (22+ supported)
- Real-time updates and trending products
- User registration and onboarding

### 2. **Farm Nation** 🌾
Agricultural land marketplace with built-in verification system.
- List agricultural properties for sale/lease
- Property verification workflow
- Map integration for location visualization
- Complete CRUD operations (create, read, update, delete)

### 3. **Marketplace** 🛒
E-commerce platform with advanced dispute resolution.
- Product listings with vendor management
- Paystack & Bank Transfer payments
- Shopping cart with delivery fee calculation
- Order tracking and fulfillment
- Dispute system with evidence upload (Firebase Storage)
- Product reviews and ratings

### 4. **Academy (LMS)** 📚
Full-featured Learning Management System.
- Course creation with multi-lesson support
- Video lessons and resources
- Quizzes with automatic grading
- Certificate generation (downloadable PDF)
- Progress tracking
- Live session scheduling

### 5. **WAVE (774 Program)** 💚
Women Agro-Value Expansion application portal.
- Multi-step application form
- YouTube video integration
- Financial information collection
- Admin approval workflow
- Application status tracking

### 6. **Cooperatives** 🤝
Microfinance cooperative management system.
- Member registration and management
- Contribution tracking
- Loan application and approval
- Loan repayment schedules
- Admin dashboard

### 7. **Admin Suite** 🔐
Comprehensive admin control panel.
- **Analytics Dashboard**: Recharts-powered revenue, user growth, and module usage charts
- **Dispute Resolution**: Evidence review, resolution actions (refund/reject)
- **Audit Logs**: Full activity tracking with filters, search, and CSV export
- User management and verification
- Content approval workflows
- Feature toggles

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ or 20+ recommended
- Firebase project with Firestore & Storage
- Paystack account (for payments)

### Installation

``

`bash
# Clone the repository
git clone https://github.com/KusuConsult-NG/Easy-sales-export.git

# Navigate to project
cd easy-sales-export-nextjs

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your credentials

# Run development server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

---

##  Environment Variables

Create `.env.local` in the root directory:

```env
# Firebase Admin SDK (Server-side)
FIREBASE_CLIENT_EMAIL=your-firebase-client-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
FIREBASE_PROJECT_ID=your-project-id

# Firebase Client SDK (Browser-side)
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-auth-domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-storage-bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id

# Paystack
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_...
PAYSTACK_SECRET_KEY=sk_test_...

# NextAuth
NEXTAUTH_SECRET=your-nextauth-secret
NEXTAUTH_URL=http://localhost:3000

# Application
NEXT_PUBLIC_URL=http://localhost:3000
```

---

## 📦 Tech Stack

| Category | Technologies |
|----------|-------------|
| **Framework** | Next.js 16 (App Router) |
| **Language** | TypeScript 5.x |
| **Database** | Firebase Firestore |
| **Storage** | Firebase Storage |
| **Authentication** | NextAuth.js + Firebase Auth |
| **Payments** | Paystack API |
| **Styling** | Tailwind CSS |
| **Charts** | Recharts |
| **Icons** | Lucide React |
| **State** | React Context API |

---

## 🏗️ Project Structure

```
easy-sales-export-nextjs/
├── src/
│   ├── app/                    # Next.js 16 App Router
│   │   ├── (modules)/         # Feature modules
│   │   │   ├── academy/       # LMS
│   │   │   ├── farm-nation/   # Land marketplace
|   │   │   ├── marketplace/   # E-commerce
│   │   │   ├── export/        # Export windows
│   │   │   ├── wave/          # WAVE program
│   │   │   ├── cooperatives/  # Microfinance
│   │   │   └── admin/         # Admin panel
│   │   ├── actions/           # Server Actions
│   │   ├── api/               # API routes
│   │   └── auth/              # Authentication
│   ├── components/            # Reusable components
│   ├── contexts/              # React contexts
│   ├── lib/                   # Utilities & config
│   │   ├── firebase.ts        # Firebase config
│   │   ├── types/             # TypeScript types
│   │   └── utils.ts           # Helper functions
│   └── styles/                # Global styles
├── public/                    # Static assets
└── .env.local                 # Environment variables
```

---

## 🔑 Key Features

### Authentication & Authorization
- Role-based access control (12 roles)
- Session management with NextAuth
- Protected routes and middleware
- Email/password authentication

### Payment Processing
- Paystack integration (card payments)
- Bank transfer option with manual verification
- Transaction verification
- Refund support

### File Management
- Firebase Storage integration
- Multi-file upload (disputes, property images)
- File validation (type, size)
- Upload progress tracking

### Real-time Features
- Live notifications
- Order status updates
- Application tracking
- Inventory management

---

## 🧪 Testing

```bash
# Run type checking
npm run type-check

# Build for production (validates all pages)
npm run build

# Run production build
npm start
```

---

## 📝 Development Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production (214 pages)
npm run start        # Start production server
npm run lint         # Run ESLint
```

---

## 🚢 Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Configure environment variables
4. Deploy!

### Manual Deployment

```bash
# Build the application
npm run build

# Start production server
npm start
```

**Environment**: Ensure all environment variables are configured on your hosting platform.

---

## 🎨 Design System

- **Colors**: Custom primary/secondary palette with dark mode support
- **Typography**: System font stack with Tailwind CSS
- **Components**: Modular, reusable React components
- **Responsive**: Mobile-first design approach
- **Accessibility**: WCAG 2.1 AA compliant (forms, ARIA labels)

---

## 📊 Platform Statistics

- **95 Pages**: Fully functional routes
- **214 Static Pages**: Production build output
- **12 Roles**: Granular permission control
- **7 Core Modules**: Complete feature sets
- **Zero Build Errors**: Production-ready
- **90%+ Complete**: All critical flows functional

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is proprietary software owned by **KusuConsult-NG**.

---

## 🙏 Acknowledgments

- **KusuConsult-NG** - Platform architecture and development
- **Next.js Team** - Framework and tooling
- **Firebase** - Backend infrastructure
- **Paystack** - Payment processing
- **Vercel** - Hosting and deployment

---

## 📞 Support

For support, email support@kusuconsult.ng or open an issue in the repository.

---

## 🗺️ Roadmap

### Phase 4 (Current - 90% → 100%)
- [x] Admin analytics dashboard
- [x] Dispute resolution system
- [x] Audit log enhancements
- [ ] E2E testing setup
- [ ] Performance optimization
- [ ] Help center

### Future Enhancements
- Mobile app (React Native)
- Advanced analytics
- AI-powered recommendations
- International payment gateways
- Multi-language support

---

**Built with ❤️ in Nigeria** 🇳🇬
