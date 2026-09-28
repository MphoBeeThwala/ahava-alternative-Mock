# DRAFT for attorney review — POPIA items 1 and 2

**Status: engineering draft, 2026-09-28. Not legal advice and not approved
text.** Prepared for Ahava's privacy attorney and Information Officer from
what the code actually does (file references below), so the legal wording
starts from accurate facts. Nothing here is live. Engineering will not
change the app's consent screen or privacy policy until the attorney
returns approved wording.

Items refer to `docs/POPIA_GAPS.md`:

- **Item 1** — offshore AI processing of symptom data is not disclosed
  (gap 1; POPIA s72, s26–27, s32, s18).
- **Item 2** — the privacy policy's list of who we share data with is
  incomplete (gaps 2 and 3; s18, s20–21, s72).

Text in `[square brackets]` is a fact the business must confirm or a
choice the attorney must make.

---

## Item 1 — AI triage: consent screen and privacy-policy section

### What actually happens today (for the attorney)

When a patient submits a symptom check (`POST /api/v1/triage`,
`apps/backend/src/routes/triage.ts`), after they tick the current consent
box:

| Sent to the AI provider | Source in code |
|---|---|
| The symptom description the patient typed | `services/aiTriage.ts` `buildTriagePrompt` |
| An optional photo, with EXIF/GPS metadata stripped first | `routes/triage.ts` `sanitizeDataUrlImage` |
| Age and gender | `routes/triage.ts` (patient context) |
| Latest vital signs (heart rate, SpO2, BP, breathing rate, temperature, HRV) with date | same |
| The patient's personal baseline (their normal heart rate / SpO2) | same |
| Risk profile answers and active health alerts | same |
| Internal case ID and internal patient ID (random identifiers, not names) | `buildTriagePrompt` |

**Not sent:** name, SA ID number, email, phone, address, medical aid details.

**Providers:** Google (Gemini API) first; Anthropic (Claude API) if Google
fails. Both process in the United States `[confirm region/terms per
provider]`. Separately, short medical search terms extracted from the
symptom text (no identifiers) are sent to the US National Library of
Medicine (PubMed/StatPearls) and the WHO ICD-11 API to look up reference
material.

A doctor reviews every AI-assisted result before the patient sees it.

The consent screen today (`workspace/src/app/patient/ai-doctor/page.tsx`)
says only "Your symptoms will be processed by an AI model". It does not
name the providers, say the data leaves South Africa, or list what is sent.

### Questions for the attorney

1. **Which s72 ground** do we rely on for the transfer — the data subject's
   consent (s72(1)(b)), binding agreements giving adequate protection
   (s72(1)(a)), or both? Engineering's suggestion is both: consent on
   screen, plus a data processing agreement with each provider.
2. **Is consent voluntary** if the AI symptom check can't be used without
   it? A patient who declines can still book a nurse visit or see a doctor
   `[confirm this is true in the product and should be stated]`. Should
   the screen say so?
3. **Provider terms.** Confirm with each provider, in writing, that API
   inputs are not used to train their models and how long they are
   retained. `[Google: the business must confirm it is on paid Gemini API
   terms — Google's free-tier terms allow use of inputs to improve its
   products. Anthropic: confirm commercial API terms.]`
4. **Special personal information.** Health data is special personal
   information (s26). Confirm the s27 authorisation relied on (consent,
   s27(1)(a); and/or s32 for health care providers).
5. Is **separate consent** needed for the photo, or can one consent cover
   text, photo and vitals if the screen lists all three?

### Proposed consent screen — v2.0 (replaces the current v1.0 modal)

> **Before we check your symptoms**
>
> To give your doctor a head start, Ahava uses an AI system to review
> what you tell us. A qualified doctor checks every result before you see
> it. It is not a diagnosis.
>
> **What we send to the AI system**
> - what you type about your symptoms
> - a photo, if you add one (we remove location and camera details first)
> - your age and gender
> - your latest health readings, your usual readings, and any active
>   health alerts on your account
>
> We do **not** send your name, ID number, contact details or medical aid
> details. Your case is labelled with a random reference number.
>
> **Who processes it, and where**
> The AI systems are run by **Google** (Gemini) and, as a backup,
> **Anthropic** (Claude). Both process data in the **United States**,
> outside South Africa. `[Attorney: add the protection relied on, e.g.
> "under agreements that require them to protect your information to a
> standard comparable to POPIA and not to use it to train their AI."]`
>
> **Your choice**
> You don't have to agree. If you don't, you can still `[book a nurse
> visit / request a doctor consultation]`. You can withdraw consent at any
> time in **Profile → Privacy**. Withdrawing stops future AI checks; it
> doesn't undo checks already done.
>
> ☐ I understand what will be sent, to whom, and that it will be processed
> outside South Africa, and I consent.
>
> [Continue] [Not now]
>
> Consent version 2.0 · [Privacy Policy]

### Proposed privacy-policy section — "Information sent outside South Africa"

> Some of the services we use process information outside South Africa.
> We do this only where POPIA allows it: `[with your consent / under
> agreements that give protection comparable to POPIA — attorney to
> choose]`.
>
> - **AI symptom checks** — if you consent, your symptom description,
>   optional photo, age, gender, and recent health readings are processed
>   by Google (Gemini) and, as a backup, Anthropic (Claude) in the United
>   States. We do not send your name, ID number or contact details. See
>   "AI symptom checks" above for details.
> - **Hosting and storage** — our servers and database are hosted by
>   Railway `[region]`, and uploaded files (photos, lab results, documents)
>   are stored with `[Cloudflare R2 / other]` `[region]`.
> - **Email** — appointment and account emails are sent through Resend in
>   `[region]`.
> - **Wearable devices** — if you connect a device, readings come to us
>   through Terra or ROOK `[regions]`.
> - **Medical reference lookups** — short medical search terms taken from
>   your symptom description, without your name or other identifiers, are
>   sent to the US National Library of Medicine and the World Health
>   Organization to find reference material for your doctor.
> - **Error monitoring** — `[only if Sentry is switched on]` when the app
>   has a technical error, a report with a random user reference and
>   technical details, but no health information, is sent to Sentry
>   `[region]`.

### What engineering will do once wording is approved

1. Replace the modal text in `workspace/src/app/patient/ai-doctor/page.tsx`
   with the approved text.
2. Record consent as version `2.0` (`PatientConsent.version` already
   exists; `requireConsent('AI_TRIAGE', '2.0')` in `routes/triage.ts`), so
   every existing user is asked again before their next AI check and we
   can prove who agreed to which wording.
3. Add the new section to `workspace/src/app/legal/privacy-policy/page.tsx`
   and update its "Last updated" date.

---

## Item 2 — privacy policy: who we share information with

The current "Data Sharing" section lists healthcare professionals, Terra,
Railway, Cloudflare R2 and legal authorities. The code also sends data to
the operators below. `[Every row: the business to confirm a signed data
processing agreement (s21) and the processing region.]`

| Operator | What they receive | Why | Where processed | In code |
|---|---|---|---|---|
| Railway | All data we hold (hosting and database) | Run the service | `[region]` | `railway.toml` |
| `[Cloudflare R2 / other S3-compatible]` | Uploaded symptom photos, lab results, generated prescriptions/referral PDFs | File storage | `[region]` | `services/objectStorage.ts` |
| Google (Gemini API) | See Item 1 | AI triage | United States `[confirm]` | `services/aiTriage.ts` |
| Anthropic (Claude API) | See Item 1 (backup only) | AI triage | United States `[confirm]` | `services/aiTriage.ts` |
| Terra | Wearable readings, only if the patient connects a device | Wearable integration | `[region]` | `routes/terra.ts` |
| ROOK | Wearable readings, only if the patient connects a device | Wearable integration | `[region]` | `routes/rook.ts` |
| Healthbridge | Patient reference, medical aid member number, ICD-10 diagnosis codes, tariff codes, practice number, visit date | Medical aid claims | South Africa `[confirm]` | `services/healthbridge.ts` |
| PayFast | Amount, item description, internal payment reference. (The patient enters their own name and card details directly on PayFast's page; we never see card numbers.) | Card payments | South Africa | `services/payfast.ts` |
| Resend | Email address, name, email content (appointment and account notices) | Sending email | `[region]` | `services/email.ts` |
| Sentry `[if enabled]` | Random user reference, role, technical error data; no health content | Error monitoring | `[EU recommended]` | `docs/OBSERVABILITY.md` |
| US National Library of Medicine; WHO ICD-11 API | Medical search terms, no identifiers | Reference material for doctors | United States; `[WHO]` | `services/evidenceProvider/` |

### Proposed replacement for privacy-policy section 5, "Data Sharing"

> We do not sell your personal information. We share it only as follows.
>
> **People involved in your care.** Nurses and doctors on Ahava who are
> treating you.
>
> **Service providers who work for us ("operators").** They may use your
> information only to provide their service to us, under written
> agreements that require them to keep it secure (POPIA s20–21):
>
> `[the table above, in plain language, with regions filled in]`
>
> **Medical aids.** If you ask us to claim from your medical aid, we send
> the claim, including diagnosis codes, through Healthbridge.
>
> **When the law requires it.** To a court, regulator or other authority
> where South African law requires us to.
>
> Where any of this happens outside South Africa, see "Information sent
> outside South Africa".

---

## Decisions needed from the business (not the attorney)

1. Railway, file-storage, Resend, Terra, ROOK and Sentry **regions**.
2. Which operators have a **signed DPA** today, and which still need one.
3. Google Gemini: **paid API terms** in place? (See Item 1, question 3.)
4. Whether declining AI consent should leave a clear **alternative route**
   in the product (Item 1, question 2).
