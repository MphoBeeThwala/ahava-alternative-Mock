# Ahava Healthcare

> **Ahava Healthcare** - A comprehensive healthcare platform designed for South Africa, connecting patients with qualified nurses for home visits and providing doctor oversight for quality healthcare delivery.

## 🏥 Overview

Ahava Healthcare is a full-stack platform that revolutionizes healthcare delivery in South Africa by enabling:

- **Patient Booking**: Easy scheduling of home healthcare visits
- **Nurse Operations**: Real-time visit management and patient communication  
- **Doctor Oversight**: Medical supervision and quality assurance
- **Admin Management**: System administration and analytics
- **Secure Payments**: Integrated payment processing with insurance support

## 🚀 Quick Start

### Prerequisites

- Node.js >= 20.0.0
- Yarn >= 4.0.0
- PostgreSQL database
- Redis instance

### Installation

```bash
# Clone the repository
git clone https://github.com/MphoBeeThwala/ahava-healthcare.git
cd ahava-healthcare

# Install dependencies
corepack yarn install

# Set up environment variables (already configured for development)
# apps/backend/.env is pre-configured with development settings

# Generate Prisma client and run migrations
corepack yarn prisma:generate
corepack yarn prisma:migrate

# Start development servers
corepack yarn dev
```

**Note**: See [Development Setup Guide](./docs/DEVELOPMENT.md) for detailed installation instructions including database setup.

### Available Scripts

```bash
# Development
corepack yarn dev                 # Start all services
corepack yarn dev:api            # Backend API only
corepack yarn dev:admin          # Admin portal only
corepack yarn dev:doctor         # Doctor portal only
corepack yarn dev:patient        # Patient app only
corepack yarn dev:nurse          # Nurse app only
corepack yarn dev:worker         # Background worker only

# Testing
corepack yarn test               # Run all tests
corepack yarn test:backend       # API tests only
corepack yarn test:web           # Frontend tests only

# Database
corepack yarn prisma:generate    # Generate Prisma client
corepack yarn prisma:migrate     # Run migrations
corepack yarn prisma:seed        # Seed database
pnpm run seed:mock-patients      # 1000 mock patients (load test)
pnpm run seed:from-synthea       # Seed from Synthea CSV (see docs/SYNTHEA_INTEGRATION_REPORT.md)
pnpm run synthea:run-and-seed    # Run Synthea JAR then seed (set SYNTHEA_JAR)
corepack yarn db:reset           # Reset database

# Code Quality
corepack yarn lint               # Check code style
corepack yarn lint:fix           # Fix code style issues
corepack yarn type-check         # TypeScript type checking
corepack yarn build              # Build all packages
```

## 🏗️ Architecture

### Monorepo Structure

```
ahava-healthcare/
├── apps/
│   ├── backend/        # Express.js API server
│   ├── admin/          # Next.js admin portal
│   ├── doctor/         # Next.js doctor portal
│   ├── patient/        # Patient mobile/web app
│   ├── nurse/          # Nurse mobile app
│   └── worker/         # Background job processor
├── packages/
│   ├── shared/         # Shared utilities and types
│   └── ui/             # Reusable UI components
├── deploy/             # Deployment configurations
└── docs/               # Documentation
```

### Core Features

#### 🔐 Authentication & Security
- JWT-based authentication with refresh tokens
- Role-based access control (Patient, Nurse, Doctor, Admin)
- End-to-end encryption for sensitive data
- HIPAA compliance considerations

#### 📱 User Management
- Multi-role user system with profile management
- Phone and email verification
- Location tracking for nurses
- Push notification support

#### 🏥 Healthcare Operations
- **Bookings**: Patient appointment scheduling
- **Visits**: Real-time visit tracking and management
- **Communication**: In-app messaging system
- **Reports**: Medical report generation and storage

#### 💳 Payment Processing
- Paystack integration for secure payments
- Insurance claim processing
- Payment status tracking
- Refund management

#### 📊 Real-time Features
- WebSocket connections for live updates
- GPS tracking for nurse locations
- Real-time messaging
- Live visit status updates

## 🛠️ Technology Stack

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis
- **Queue**: BullMQ for background jobs
- **Authentication**: JWT with bcrypt
- **File Processing**: Sharp, PDFKit
- **Real-time**: WebSocket

### Frontend
- **Framework**: Next.js (React)
- **Language**: TypeScript
- **Styling**: CSS Modules / Tailwind CSS
- **State Management**: React Query / Zustand
- **Maps**: Google Maps API

### Infrastructure
- **Deployment**: Railway (primary), Render, Fly.io
- **CI/CD**: GitHub Actions
- **Monitoring**: Railway dashboard
- **File Storage**: Local volumes

## 🚀 Deployment

Ahava Healthcare supports multiple deployment platforms:

- **Railway** (Primary): One-click deployment with managed databases
- **Render**: Alternative platform with auto-scaling
- **Fly.io**: Container-based deployment

See [Deployment Guide](./deploy/README.md) for detailed setup instructions.

## 🔧 Configuration

### Environment Variables

Key environment variables for the backend:

```bash
# Database
DATABASE_URL=postgresql://...

# Cache
REDIS_URL=redis://...

# Authentication
JWT_SECRET=your-32-character-secret
ENCRYPTION_KEY=base64-encoded-32-byte-key

# Payments
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_WEBHOOK_SECRET=your-webhook-secret

# Timezone
TIMEZONE=Africa/Johannesburg
```

## 📋 Database Schema

The platform uses a comprehensive PostgreSQL schema with the following main entities:

- **Users**: Patients, nurses, doctors, admins
- **Bookings**: Appointment scheduling
- **Visits**: Home visit management
- **Messages**: Real-time communication
- **Payments**: Transaction processing
- **Reports**: Medical documentation

See [Prisma Schema](./apps/backend/prisma/schema.prisma) for complete details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:

- **Email**: support@ahavahealthcare.co.za
- **Documentation**: [docs.ahavahealthcare.co.za](https://docs.ahavahealthcare.co.za)
- **Issues**: [GitHub Issues](https://github.com/MphoBeeThwala/ahava-healthcare/issues)

## 🌍 Localization

Ahava Healthcare is designed for South Africa with:

- **Timezone**: Africa/Johannesburg (SAST)
- **Language**: English (en-ZA) with support for local languages
- **Currency**: South African Rand (ZAR)
- **Compliance**: Local healthcare regulations

---

**Built with ❤️ for South African healthcare**
