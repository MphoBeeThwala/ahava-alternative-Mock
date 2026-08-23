# Ahava Healthcare - Architecture

## Overview

Ahava Healthcare is a full-stack healthcare platform for South Africa.

## System Architecture

### Frontend
- Framework: Next.js 15.5.9 (App Router)
- Location: workspace/
- Styling: Tailwind CSS v4, Material-UI v7
- Language: TypeScript

### Backend
- Framework: Express.js
- Location: apps/backend/
- ORM: Prisma (PostgreSQL + TimescaleDB)
- Authentication: JWT with role-based access control
- Task Queue: BullMQ with Redis

### Machine Learning Service
- Framework: FastAPI (Python)
- Location: apps/ml-service/
- Database: TimescaleDB
- Features: Early warning analysis, biometric anomaly detection, progressive personal baselines

### Clinical Decision Support (RAG + Guardrails)
- Grounding Source: NCBI StatPearls (with Redis caching)
- Pattern: Retrieved grounding context + deterministic rule-based guardrails
- Guardrails: triageSafety.ts - rules engine can only escalate urgency, never override downward
- Safety: requiresDoctorReview enforced for low-confidence/low-evidence cases
- Evidence Base: StatPearls, SEMDSA guidelines, SA NDoH treatment guidelines, WHO protocols

### Payment Processing
- Gateway: PayFast (to be integrated)
- Use Cases: Nurse visit fees, telemedicine consult fees

### Wearable Integration
- Providers: Terra, ROOK
- Baseline System: Progressive personal baseline via TimescaleDB (engine.py)

### Security & Compliance
- Authentication: JWT with refresh tokens
- Authorization: Role-based middleware (PATIENT, NURSE, DOCTOR, ADMIN)
- Data Protection: POPIA compliant, encryption for PII
- Audit: AuditLog written on every PHI access
- Consent: Explicit consent required for AI triage
- Image Handling: EXIF metadata stripped from uploaded medical images

## Deployment

### Supported Platforms
- Primary: Railway
- Alternatives: Render, Fly.io

### Services
- apps/backend - API service (port 4000)
- workspace - Frontend (port 3000)
- apps/ml-service - ML service (port 8000)
- PostgreSQL - Database
- Redis - Cache & task queue

## Technology Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS, MUI |
| Backend | Express.js, Prisma, PostgreSQL, TimescaleDB, BullMQ, Redis |
| ML Service | FastAPI, Python 3.11+, pandas, numpy |
| Authentication | JWT, bcrypt |
| Real-time | WebSockets |

## Data Models

### Core Models
- User: Patients, nurses, doctors, admins with role-based permissions
- Booking: Patient booking requests with payment tracking
- Visit: Nurse/doctor visits with biometrics, treatment records
- TriageCase: AI-assisted triage cases with doctor review
- Payment: Payment transactions
- BiometricReading: Wearable and manual biometric data
- HealthAlert: Anomaly-based health alerts
- UserBaseline: Progressive personal biometric baselines
- Prescription: Doctor-issued prescriptions
- Referral: Doctor referrals to facilities
- AuditLog: Comprehensive audit trail for PHI access

## Security Considerations

- All PHI access requires authentication and role-appropriate authorization
- JWT secrets and encryption keys must be configured (no fallback to random values)
- EXIF metadata is stripped from all uploaded medical images
- Consent is required for AI triage participation
- Case isolation: No shared conversation state across patients

## Compliance

- POPIA: South African Protection of Personal Information Act compliance
- HPCSA: Health Professions Council of South Africa compliance for doctors
- SANC: South African Nursing Council verification for nurses
