# Ahava Healthcare (on 88) – Investment Business Plan

**AI-powered home healthcare platform for South Africa**

---

## 1. Cover and Executive Summary

### Title
Ahava Healthcare (on 88) – Investment Business Plan

### Subtitle
AI-powered home healthcare platform for South Africa

### Executive Summary

**Problem.** South Africa faces constrained access to quality primary care, overcrowded facilities, and a growing need for home-based care and triage. Patients struggle to book visits, coordinate with nurses, and get timely oversight from doctors. Care is fragmented and payment options are limited.

**Solution.** Ahava Healthcare is a single platform that connects patients with qualified nurses for home visits, provides doctor oversight for quality assurance, and adds AI-assisted triage using symptoms, medical images, and biometric data. Patients book visits, pay by card or insurance (Paystack), and receive care with full visibility for clinicians. All AI output is reviewed by licensed professionals (human-in-the-loop).

**Market.** The platform is built for South Africa: timezone (Africa/Johannesburg), currency (ZAR), and alignment with local healthcare guidelines (NDOH, EML). Target segments include primary care, chronic care, and post-discharge follow-up.

**Traction.** The platform is built and production-ready: backend API (Express, PostgreSQL, Prisma), unified Next.js web app (Patient, Nurse, Doctor, Admin dashboards), Paystack integration, AI triage (Google Gemini), and deployment configs for Railway, Render, and Fly.io. Pre-launch checklist items (production env, DB backups, monitoring) are documented and addressable.

**Ask.** [To be completed: funding amount, runway, and key milestones.]

---

## 2. Business Case

### Problem Statement

- Access to quality primary care in South Africa is limited; facilities are overburdened.
- Home-based care and nurse-led visits are underused due to coordination and trust frictions.
- Triage and symptom assessment are often delayed or inconsistent.
- Payment and insurance claims add administrative load for providers and patients.

### Solution

Ahava delivers one integrated platform:

- **Patient booking:** Scheduling of home healthcare visits with address, date, duration, and payment method (card or insurance).
- **Nurse operations:** Real-time visit management, GPS-based assignment, status updates (scheduled, en route, arrived, in progress, completed), and in-app messaging.
- **Doctor oversight:** Review and approval of visits, review of AI triage cases (approve, override, or refer), and quality assurance.
- **AI-assisted triage:** Patients submit symptoms, optional medical images (e.g. X-ray, dermatology), and biometric data. Google Gemini powers preliminary analysis; cases are routed by specialty and priority. All outputs are reviewed by a doctor or nurse before release.
- **Payments:** Paystack for card payments and insurance claim processing; payment status and refunds tracked in-platform.

### Market

- **Geography:** South Africa first; design supports local compliance (POPIA) and healthcare norms.
- **Segments:** Primary care, chronic disease management, post-discharge follow-up, and home-based nursing.
- **Regulatory context:** Alignment with NDOH/EML and clinical guidelines; human oversight of AI to support safe, accountable care.

### Revenue Model

- **Booking and visit fees:** Revenue from completed home visits (patient or insurer pays).
- **Paystack:** Transaction flow for card payments; platform can retain a margin or pass-through per commercial agreement.
- **Insurance:** Insurance claim processing and verification (CARD and INSURANCE payment methods in-platform).
- **AI triage (optional):** Specialty- and priority-based pricing in ZAR (e.g. Nursing R500 base, General Practice R800, Cardiology R2,000, Emergency R3,000; adjusted by priority: LOW 0.8x, MEDIUM 1x, HIGH 1.3x, URGENT 1.5x). Examples: skin rash (Dermatology, LOW) ~R960; chest pain (Cardiology, URGENT) ~R3,000.

### Competitive Edge

- **Integration:** Combined home visits, doctor oversight, and AI triage in one product (no separate triage and visit tools).
- **South Africa–first:** Built for SA timezone, language (en-ZA), currency (ZAR), and guideline alignment.
- **Human-in-the-loop:** AI supports clinicians; every triage output is reviewed before release to the patient.

---

## 3. Technical Overview

### Tech Stack (Current Codebase)

**Backend**

- Runtime: Node.js (>=20) with TypeScript
- Framework: Express.js
- Database: PostgreSQL with Prisma ORM
- Cache and queue: Redis, BullMQ for background jobs
- Authentication: JWT with refresh tokens, bcrypt
- AI: Google Generative AI (Gemini) for symptom and image analysis
- Payments: Paystack (card and insurance; webhooks)
- File processing: Sharp, PDFKit
- Real-time: WebSocket (visit and location updates)

**Frontend**

- Framework: Next.js 15 (React 19)
- Language: TypeScript
- Styling: Tailwind CSS
- Single app: Unified web app with role-based dashboards (Patient, Nurse, Doctor, Admin)

**Infrastructure**

- Deployment: Railway (primary), Render, Fly.io
- CI/CD: GitHub Actions
- Package management: pnpm; monorepo with workspaces (e.g. apps/backend, workspace)

### Architecture

- **Monorepo:** Backend (Express API), frontend (Next.js in `workspace`), shared packages.
- **Single API:** One backend serves all roles; role-based access control (PATIENT, NURSE, DOCTOR, ADMIN).
- **Real-time:** WebSocket for nurse location and visit status; supports “notify nearby nurses” for booking assignment.
- **Data model (Prisma):** Users (with role, verification, availability, location for nurses); Bookings (patient, scheduled date, address, payment method, insurance fields); Visits (booking, nurse, doctor, status lifecycle); Payments (visit, status, Paystack reference); Messages; BiometricReadings; HealthAlerts; TriageCases (patient, AI output, doctor review status).

### Core Capabilities

- **Auth and RBAC:** JWT with refresh tokens; encrypted sensitive fields; rate limiting and Helmet for security headers.
- **Bookings and visits:** Full lifecycle from booking creation to completed visit; nurse assignment (including location-based); doctor approval and status updates.
- **Payments:** Paystack integration with webhooks; payment method CARD or INSURANCE; insurance provider and member number support; status tracking (PENDING, PROCESSING, COMPLETED, FAILED, REFUNDED).
- **AI triage:** Patient submits symptoms and optional images; Gemini used for analysis; specialty routing and priority (LOW/MEDIUM/HIGH/URGENT); doctor review (approve, override, or refer); cost calculation by specialty and priority.
- **Biometric monitoring:** Biometric readings and health alerts; supports baseline and early warning.
- **Storage and encryption:** Sensitive data encrypted; file handling via Sharp/PDFKit; production storage can use local volumes or external object storage.

### Security and Compliance

- HTTPS, secure headers (Helmet), and CORS configuration.
- Encryption for sensitive fields (e.g. address, ID number); JWT secrets and encryption keys via environment variables.
- Rate limiting on the API.
- Human-in-the-loop: all AI triage output is reviewed by a licensed professional before release.
- POPIA and healthcare compliance: design supports consent, audit trail, and data minimisation; legal and compliance roadmap to be formalised with advisors.

### Deployment and Operations

- **Ready:** Backend API, database schema, auth, bookings, visits, payments, AI triage, deployment configs (Railway, Render, Fly.io), PNPM and Prisma set up.
- **Pre-launch:** Production environment variables (JWT, encryption keys, Paystack production keys, DATABASE_URL, REDIS_URL); run production migrations; database backups and connection pooling; CORS for production domains; monitoring and error tracking (e.g. Sentry); optional ML service URL or disable if not used.
- **Frontend:** Next.js app in `workspace` contains all four role dashboards; deployment configs can be updated to build and serve this app (e.g. as the primary frontend).

---

## 4. Operations

### Day-to-Day Operations

- **Nurse scheduling and visit assignment:** Assign visits to available nurses; use location and status (scheduled, en route, arrived, in progress, completed) to manage workload.
- **Patient support:** Handle booking and payment queries; support for insurance verification and payment failures.
- **Payment and insurance:** Monitor Paystack webhooks and payment status; support insurance verification and claim follow-up.
- **Platform monitoring:** Uptime, error rates, and critical flows (auth, booking, payment, triage); alerts for failures and capacity.

### Clinical Operations

- **Doctor oversight:** Review and approve visits; review AI triage cases (approve, add diagnosis, or refer); ensure every triage output is signed off before release.
- **Workflows:** Triage case statuses (e.g. PENDING_REVIEW, APPROVED, DOCTOR_OVERRIDE, REFERRED) support clear escalation and referral paths.
- **Guidelines:** Clinical content and triage logic aligned with NDOH/EML and local guidelines; prompts and specialty routing designed for SA context.

### Compliance and Risk

- **POPIA:** Consent, purpose limitation, and secure handling of personal and health data; encryption and access control in place; audit trail to be enhanced where required.
- **Human-in-the-loop:** AI is an aid; final responsibility remains with the licensed professional.
- **Incidents and escalation:** Defined escalation paths (e.g. refer to in-person or partner); incident response plan to be documented and tested.

---

## 5. Financial and Cost Overview

### Revenue Streams

- Visit and booking fees (ZAR).
- Insurance claims processed through the platform.
- Optional AI triage fees (ZAR), with pricing by specialty and priority as described in the Business Case.

### Operational Cost Summary (Order of Magnitude)

- **Hosting (Railway or equivalent):** Managed PostgreSQL and Redis; application hosting; variable with usage.
- **AI (Google Gemini):** Usage-based; on the order of tens of USD per month for moderate volume (e.g. thousands of analyses).
- **Payments (Paystack):** Transaction fees per payment; terms as per Paystack agreement.
- **Storage and bandwidth:** Depends on volume of images and data; local or cloud object storage.
- **Monitoring and tools:** Optional (e.g. error tracking, uptime); low to moderate monthly cost.

*Note: The live stack uses Express, PostgreSQL, and Railway (or Render/Fly.io), not Cloudflare Workers or D1. Cost estimates should be based on this stack.*

### Use of Funds

[To be completed: allocation of investment (e.g. product, operations, compliance, marketing, runway).]

### Funding Ask

[To be completed: amount, key milestones, and use of funds.]

---

## 6. Risks and Mitigation

### Technical

- **Dependency on third-party APIs (e.g. Gemini, Paystack):** Mitigation: environment-based configuration; monitoring and alerts; fallbacks or graceful degradation where feasible.
- **Uptime and performance:** Mitigation: deployment on reliable infrastructure (Railway/Render/Fly.io); database backups; health checks and monitoring.

### Regulatory

- **Healthcare and data protection in South Africa:** Mitigation: compliance roadmap; legal and regulatory advice; human oversight of AI; consent and audit trail.
- **Evolving regulation:** Mitigation: stay abreast of POPIA and healthcare authority guidance; design for data portability and retention policies.

### Operational

- **Nurse and doctor availability:** Mitigation: verification and onboarding; clear assignment and queue management; escalation paths.
- **Quality of care:** Mitigation: doctor oversight of visits and triage; structured review and release workflow; feedback and incident handling.

---

## 7. Team and Next Steps

### Team

Ahava is structured for lean, startup-friendly execution. The team combines technical leadership (full-stack, backend, frontend), operations and general management (scheduling, support, partners), and clinical leadership (medical oversight, guideline alignment, and AI-review policy). Roles can be combined or expanded as the company scales. A dedicated team structure document can outline exact roles and hiring plan.

### Next Steps

- **Launch checklist:** Complete production environment variables (JWT, encryption, Paystack production, DATABASE_URL, REDIS_URL); run production migrations; enable database backups; configure CORS and monitoring; deploy frontend (e.g. from `workspace`) and point to production API.
- **First pilots:** Run controlled pilots with a small set of patients, nurses, and doctors; validate booking-to-visit flow, payments, and triage review; gather feedback.
- **Metrics:** Define and track KPIs (e.g. bookings per week, visit completion rate, payment success rate, triage review time, user satisfaction) and iterate on product and operations.

---

*Document version: 1.0. Export this document to PDF as needed (e.g. “Ahava on 88 NVESTMENT BUSINESS PLAN.pdf”).*
