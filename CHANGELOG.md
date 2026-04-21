# Changelog

All notable changes to Ahava Healthcare will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2024-09-29

### Added
- **Development Environment Setup**: Complete local development environment configuration
- **Database Setup**: PostgreSQL and Redis installation and configuration
- **Security Configuration**: Generated secure JWT secrets and encryption keys
- **Local Database**: Created `ahava-healthcare` database with proper user permissions
- **Environment Variables**: Configured `.env` file with development settings

### Development Setup
- **Node.js**: v20.19.5 installed and configured
- **Yarn**: v4.3.1 with Corepack enabled for workspace management
- **PostgreSQL**: v15.14 with database and user setup
- **Redis**: v7.0.15 for caching and session management
- **Dependencies**: All project dependencies installed successfully

### Technical Details
- Database URL: `postgresql://ahava_user:ahava_dev_password@localhost:5432/ahava-healthcare`
- JWT Secret: Securely generated 64-character hex string
- Encryption Keys: Base64 encoded 32-byte key with 16-byte IV salt
- Redis URL: `redis://localhost:6379`
- Timezone: Africa/Johannesburg (SAST)

## [1.0.0] - 2024-09-29

### Changed
- **BREAKING**: Project renamed from "kykthuto" to "Ahava Healthcare"
- Updated all package names from `@kykthuto/*` to `@ahava-healthcare/*`
- Updated deployment configurations to reflect new project name
- Updated documentation and README files

### Added
- Initial project structure for healthcare platform
- Backend API with Express.js and Prisma
- Database schema for healthcare operations (users, bookings, visits, payments)
- Authentication and authorization system
- Real-time messaging and notifications
- Payment integration with Paystack
- PDF generation for reports
- Deployment configurations for Railway, Render, and Fly.io

### Features
- **Patient Management**: Book home visits, track appointments, manage profile
- **Nurse Operations**: Accept visits, real-time location tracking, patient communication
- **Doctor Oversight**: Review nurse reports, provide medical guidance, quality assurance
- **Admin Portal**: System administration, user management, analytics
- **Payment Processing**: Secure payment handling with insurance support
- **Real-time Communication**: In-app messaging between patients, nurses, and doctors
- **Location Services**: GPS tracking for nurse visits and route optimization
- **Multi-language Support**: English and local language support for South Africa
- **Security**: End-to-end encryption for sensitive data, HIPAA compliance considerations

### Technical Stack
- **Backend**: Node.js, Express.js, TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis for sessions and job queues
- **Queue**: BullMQ for background job processing
- **Authentication**: JWT with refresh tokens
- **Real-time**: WebSocket connections
- **Payments**: Paystack integration
- **File Processing**: Sharp for image optimization, PDFKit for reports
- **Deployment**: Railway (primary), Render and Fly.io (alternatives)

### Infrastructure
- **Database**: PostgreSQL with managed hosting
- **Cache**: Redis for session management and job queues
- **File Storage**: Local storage with volume mounts for PDF exports
- **Monitoring**: Railway dashboard and GitHub Actions CI/CD
- **Security**: Environment-based configuration, encrypted sensitive data
- **Timezone**: Africa/Johannesburg (SAST)

### Development
- **Package Manager**: Yarn 4.3.1 with workspaces
- **Language**: TypeScript with strict configuration
- **Testing**: Jest with Supertest for API testing
- **Linting**: ESLint with Prettier for code formatting
- **CI/CD**: GitHub Actions for automated deployment
