# Privacy policy, terms and POPIA — gaps against the code

**Not legal advice.** This is an engineering comparison of what the public
legal pages say against what the code actually does, written 2026-09-26 for
whoever signs off the legal text (the Information Officer and a South African
privacy attorney). Every claim below cites the file it comes from.

## What exists

Contrary to an earlier review note, there **is** a privacy policy and terms
of service in the repo, live on the site:

- `workspace/src/app/legal/privacy-policy/page.tsx` — "Last updated: March 2026"
- `workspace/src/app/legal/terms/page.tsx` — "Last updated: March 2026"
- Consent capture: `apps/backend/src/routes/consent.ts` (types `AI_TRIAGE`,
  `BIOMETRIC_MONITORING`, `DATA_SHARING`, `MARKETING`, versioned, with IP/UA
  and audit log); the AI-triage consent modal in
  `workspace/src/app/patient/ai-doctor/page.tsx`.

Both pages read as templates written before the current feature set. None of
them record who drafted or approved them. What's missing is below.

## Gaps — the policy says something the code contradicts, or omits

| # | Gap | Evidence in code | POPIA hook | Severity |
|---|---|---|---|---|
| 1 | **Offshore AI processing not disclosed.** Symptom narratives (health data — special personal information) are sent to Google Gemini and, as fallback, Anthropic Claude. The policy's "Data Sharing" section lists Terra, Railway and Cloudflare R2 only. The AI-triage consent modal says "processed by an AI model" but not by whom or that it leaves South Africa. Already an open engineering item (AH-15, `ENGINEERING_PLAN.md` §5). | `apps/backend/src/services/aiTriage.ts` (`GoogleGenerativeAI`, `CLAUDE_MODEL`) | s72 (transborder flows), s26–27, s32 (health data), s18 (notification) | **High** |
| 2 | **Other operators not listed**: Resend (transactional email), PayFast (payments), ROOK (wearables, alongside Terra), Healthbridge (medical-aid claims — sends clinical/billing data to medical schemes), S3-compatible object storage configurable beyond R2, and now Sentry (error tracking, `docs/OBSERVABILITY.md`). | `services/email.ts`, `services/payfast.ts`, `routes/rook.ts`, `services/healthbridge.ts`, `services/objectStorage.ts` | s18, s20–21 (operators, written contracts), s72 | High |
| 3 | **Hosting location not stated.** Railway runs in regions outside SA; the policy names Railway but not that data is stored offshore. | `railway.toml`, `deploy/README.md` | s72 | High |
| 4 | **Retention period contradicts the internal decision.** Policy: "minimum of 5 years as required by the National Health Act". `ENGINEERING_PLAN.md` §6 item 3 decided 7 years for clinical records (HPCSA guidance: 6 years minimum, longer for minors), 2 years for wearable telemetry, consent life-of-account + 7 years — and flagged it "have this confirmed by legal". The Act citation itself should be checked. No purge job exists yet. | `docs/ENGINEERING_PLAN.md` §5 "POPIA operations", §6 item 3 | s14 | Medium |
| 5 | **Data-subject rights have no implementation.** Policy promises access, correction, deletion. There is no data-export or erasure endpoint (the `ExportJob` model exists unused); deletion is "by contacting support". Terms §11 same. Workable at zero users with a manual process, but the process isn't written down. | `ENGINEERING_PLAN.md` §5 "POPIA operations" | s23–25, PAIA | Medium |
| 6 | **Biometric processing without a consent gate.** Policy says health/wearable data is processed on the basis of consent. `requireConsent` is only applied to AI triage; wearable ingestion routes (Terra, ROOK, Health Connect) don't check `BIOMETRIC_MONITORING` consent — only the doctor dashboard filters by it. | `routes/triage.ts:274` (only `requireConsent` use), `routes/doctorMonitoring.ts:36` | s11, s27(1)(a) | Medium |
| 7 | **Age.** Terms: users must be 18+ "or have the consent of a parent or legal guardian". Signup doesn't collect a date of birth as required or check age, and the triage engine has paediatric charts, implying children are patients. Children's data needs a competent person's consent (s35) and the policy doesn't address minors at all. | `routes/auth.ts` (`dateOfBirth` optional), `services/triageThresholds/` | s34–35 | Medium |
| 8 | **Breach notification.** Policy: "we will notify you promptly". POPIA s22 requires notifying the Information Regulator and data subjects as soon as reasonably possible. No incident-response runbook exists in `docs/`. | `docs/` | s22 | Medium |
| 9 | **Information Officer.** Policy gives `privacy@ahavahealthcare.co.za` but no named Information Officer; registration with the Information Regulator isn't recorded anywhere. No PAIA manual is referenced. | privacy-policy page §10 | s55–56, PAIA s51 | Medium |
| 10 | **Cookies.** Policy: "essential cookies for authentication". Worth confirming against how auth tokens are actually stored (localStorage vs cookies) so the statement is accurate. | `workspace/src/lib/api/` | s18 | Low |
| 11 | **Liability cap / clinical disclaimer.** Terms cap liability at 12 months' fees and disclaim reliance on "system-generated content". Whether that is enforceable for a health service under the Consumer Protection Act (s48–51, s61) is a question for an attorney, especially given triage logic that has not been clinician-reviewed (`docs/clinical-review/TRIAGE_SAFETY_REVIEW_PACKET.md`). | terms page §5, §10 | CPA, not POPIA | Legal review |

## What engineering can do once legal has settled the wording

- Version the AI-triage consent text naming the operators and the transfer
  (the `version` field already exists in `PatientConsent`), and re-prompt
  existing users when it changes — AH-15.
- Add `requireConsent('BIOMETRIC_MONITORING')` to wearable ingestion (gap 6).
- Build export/erasure endpoints and the retention purge job (gaps 4, 5).
- Make date of birth required at signup and route under-18 accounts to a
  guardian-consent flow (gap 7).
- Put "Last reviewed by / date" on both legal pages so their provenance is
  recorded like the clinical sign-offs are.

None of these should ship ahead of the legal text they implement.
