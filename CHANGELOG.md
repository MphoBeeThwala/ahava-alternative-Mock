# Changelog

All notable changes to Ahava Healthcare will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed (AI triage incident, 2026-10-06)
- **AI triage no longer fails silently, and never shows a guessed diagnosis.** A complex neurological test case was rated "viral infection, SATS 4" because the AI never ran and the keyword fallback invented a diagnosis. Provider calls now use configurable model chains with automatic fallback and discovery of the models each provider offers, a 90 s timeout, correct handling of `thinking` blocks and `max_tokens`, and the full case text (24,000 characters; nothing cut silently). Lab/imaging attachments and stored photos now reach the model.
- With no AI, a case gets no possible conditions ("AI analysis unavailable"), a priority of at least SATS 3 (emergency red flags still SATS 1), a red banner for the doctor, and automatic re-analysis (2 min, 10 min, 30 min, 2 h) that never overwrites a case a doctor has claimed.
- Administrators are emailed when AI triage goes down or recovers; status on the admin dashboard, `GET /admin/ai-health` and `/ready`.
- New conservative neurological rules (SATS 3 floor); **need clinical sign-off**.
- Triage descriptions over 20,000 characters are refused with a message to attach long reports as files.

### Security
- **Role gates**: `requirePatient`, `requireNurse` and `requireDoctor` now admit only their own role. Admin accounts were previously let through all three, contradicting the separation-of-duties model in `services/careAccess.ts`.
- **Email changes need re-authentication**: `PUT /auth/profile` requires the current password (plus a TOTP or backup code when 2FA is on) to change the sign-in email. A successful change signs out other devices, un-verifies the address, notifies the old address and is audited (`EMAIL_CHANGED` / `EMAIL_CHANGE_FAILED`).
- **Hashed one-time tokens**: password-reset and email-verification tokens are stored as SHA-256 hashes (`services/oneTimeTokens.ts`). Email verification links now actually expire after 24 hours (`emailVerificationExpiry`).
- **Trial-data reset**: `POST /admin/reset-trial-data` is refused in production unless `ALLOW_TRIAL_DATA_RESET=true`; refused attempts are audited.

- **Step-up authentication**: invites, account reactivation, credential verification, 2FA resets, admin grants, break-glass, refunds and trial-data reset need a fresh authenticator code (5-minute window). The web app prompts and retries.
- **Staff session limits**: 5-minute access tokens, 15-minute idle timeout and 12-hour absolute lifetime for nurses, doctors and admins; patients unchanged. Staff are told why they were signed out.
- **Login throttling**: failures counted per account+IP (5) and per account (25) instead of per email alone, so a stranger can no longer lock a named user out with five guesses. Falls back to in-process counters if Redis is down rather than failing open.

- **Sign in with Google (patients only)**: off until `GOOGLE_CLIENT_ID` is set. Verified ID token + nonce cookie; identities matched on Google's `sub`; staff accounts are refused; an existing password account is linked only after its password (and 2FA code) is confirmed; unlink needs the password. See `docs/ENGINEERING_PLAN.md` §43 for setup.

### Deployment notes
- Run migration `20261005140000_add_auth_identities` (new `auth_identities` table).
- Run migrations `20261005120000_hash_one_time_tokens` and `20261005130000_add_step_up_verified_at`. Staff are signed out once on deploy.
- Run migration `20261005120000_hash_one_time_tokens`. It clears any outstanding reset / verification tokens (they were stored in clear and can no longer match); affected users use "Forgot password" / "Resend verification".
- Reset and verification emails already in inboxes stop working after deploy.

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
