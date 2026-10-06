# Research data pipeline

Silent, consent-gated capture of the data a future predictive service needs
(readings, risk factors, clinician-confirmed outcomes), plus the offline tooling
to train and evaluate models on it and to say, with numbers, when there is
enough to seek validation. Nothing here changes a live decision or is shown to a
patient or clinician.

**Status:** capture, tooling and shadow scoring are built and tested. **No model
exists and none is running.** There is no data yet, and a model trained on a few
dozen events would be noise. The pipeline's job today is to start accruing the
right data, in the right form, from consenting patients.

## What it does

```
patient opts in (RESEARCH_DATA consent, optional, profile page)
        │
 readings arrive (wearable, Health Connect, manual)      doctor finishes a triage case ──┐
        │                                                doctor records a confirmed ─────┤
 sweep every 15 min (backend)                            outcome (POST /research/outcomes)│
        │  consent? adult patient? dated after consent?                                  │
        ▼                                                                                ▼
 research_snapshots  ◄── pseudonym + generalised, no identity        research_outcomes (structured, no free text)
        │
        │  approved shadow model? ──► ML service /research/shadow-predict (numpy only, no ids)
        ▼
 research_predictions  (stored beside the row; never returned by any route)

 offline, by a data scientist with a read-only login:
   python -m research readiness | triage | train | models | approve | revoke
```

## Privacy design (what the code enforces)

| Rule | Where |
|---|---|
| Separate, opt-in consent (`RESEARCH_DATA`, v1.0); never implied by another consent | `routes/consent.ts` |
| Prospective only: nothing dated before the consent is captured | `researchCapture.ts`, `researchSweep.ts` |
| Adults only, patients only, active accounts only | `researchFeatures.ts`, `researchCapture.ts` |
| Pseudonym = HMAC-SHA256(`RESEARCH_PSEUDONYM_KEY`, userId); no key, no capture; no fallback key | `pseudonym.ts` |
| No FK to users; no names, contacts, ID, location, messages, free text, exact timestamps | `schema.prisma`, `researchFeatures.ts` |
| Generalised: 5-year age band, day-level dates, BMI instead of weight/height | `researchFeatures.ts` |
| Implausible values become null, never clamped or defaulted; unknown risk factors stay unknown, never "no" | `researchFeatures.ts` |
| Withdrawal deletes snapshots, predictions (cascade) and outcomes; the API says plainly if it could not | `routes/consent.ts`, `purgeSubject` |
| Consent reset / user removal in admin tooling also clears research rows | `routes/admin.ts`, `scripts/targeted-reset.ts` |
| Outcomes entered only by a verified doctor holding an active care grant; audited without the clinical content | `routes/researchOutcomes.ts` |
| Outcomes are structured: a fixed type list, a day, an optional ICD-10 *format*-checked code, a whitelisted `basis` | `researchOutcomes.ts` |
| Capture never delays or fails a clinical request; errors are swallowed and logged without ids | `researchCapture.ts` |
| Training reads through a read-only login on three tables, nothing else | `scripts/research-db-role.ts` |

**It is pseudonymised, not anonymised**, because Ahava keeps the means to
recompute the pseudonym (that is what makes deletion on withdrawal possible). It
is still personal information under POPIA and the patient-facing wording says so.

## Switching it on

1. `RESEARCH_PSEUDONYM_KEY`: at least 32 random characters, in the backend's secrets
   (`openssl rand -base64 48`). **Key custody matters:** lose it and withdrawals
   cannot delete the person's rows (the pseudonym can no longer be recomputed);
   change it and every existing row is orphaned. Store it in the secret manager,
   back it up like the encryption key, never rotate it without a re-keying
   migration, and keep it away from the research database credentials: whoever
   holds the research tables *and* the key *and* a list of user ids can re-link people.
2. Deploy. The migration `20261006120000_add_research_data_pipeline` creates the tables.
3. Nothing is captured until a patient opts in on **Profile → "Help build better
   early warning for African patients"**. Check accrual: `GET /api/v1/admin/research/status`
   (counts only).
4. `RESEARCH_CAPTURE_ENABLED=false` switches capture off without removing the key.

`RESEARCH_SWEEP_INTERVAL_MS` (default 900000), `RESEARCH_SHADOW_ENABLED` (default on,
and a no-op until a model is approved) tune the rest. See `apps/backend/env.example`.

## Recording outcomes (the part that decides whether this is ever useful)

A model is only as good as its labels. Readings without outcomes teach nothing.

- **Automatic:** when a doctor releases a triage result, issues a prescription or
  a referral, the AI's level and the doctor's final level are recorded
  (`TRIAGE_REVIEWED`), plus `EMERGENCY_REFERRAL` for emergency referrals.
- **Clinician-entered:** `POST /api/v1/research/outcomes`
  `{ patientId, outcomeType, outcomeDay: "YYYY-MM-DD", icd10?, basis?, alertLevel? }`
  for `HYPERTENSION_DIAGNOSED, DIABETES_DIAGNOSED, CVD_EVENT, ARRHYTHMIA_DIAGNOSED,
  HOSPITAL_ADMISSION, DEATH, ALERT_CONFIRMED, ALERT_DISMISSED`. **There is no UI for
  this yet** (see "Not done").
- Negatives are only as reliable as outcome recording: a patient with no recorded
  outcome is counted as event-free once follow-up has elapsed. If clinicians do
  not record outcomes, the data will say everyone is healthy.

## Offline workflow

```bash
cd apps/ml-service && pip install -r requirements-research.txt
export RESEARCH_DATABASE_URL=...        # from: pnpm --filter backend research-db-role
python -m research readiness            # is there enough? per target, with deficits and a rough ETA
python -m research triage               # AI-vs-doctor agreement, under-triage rate with 95% CIs
python -m research train --target adverse_event_90d      # CANDIDATE + model card (refuses if too few events)
python -m research approve adverse_event_90d <version> --by "Dr Full Name"   # SHADOW scoring only
```

Try it without patient data: add `--source synthetic` (everything is flagged
synthetic, and the registry **refuses to approve** a synthetic model).

**Targets** (`research/outcomes.py`): `adverse_event_90d` (CVD event, admission,
emergency referral or death), `hypertension_180d`, `diabetes_365d`. Add one there.

**What keeps the evaluation honest** (each rule has a test, and the tests were
checked by breaking the rule and watching them fail):

- *Incident, not prevalent:* rows after the outcome, or where the condition is already known, are excluded.
- *Censoring:* a row is a negative only if the person was observed for the full horizon.
- *Causality:* features see strictly earlier days; one implementation for training and scoring.
- *Subject-level splits:* grouped, event-stratified K-fold; a temporal hold-out on the latest-enrolled people.
- *Events are people:* readiness and model cards count people with the outcome, not positive rows (one person's 40 pre-event readings are one event).
- *Intervals and baselines:* subject-clustered bootstrap CIs; the model is compared with the live alert level and the Framingham score on the same rows; calibration (slope, intercept, ECE), alert burden and decision-curve net benefit are reported with subgroup results (sex, age) or "too few events".
- *Fixed hyperparameters*, so results are not flattered by selection; a pure-noise target must score about chance (tested).
- *Auditable model:* L2 logistic regression exported as JSON (every coefficient readable, no pickle, numpy-only scoring in the live service).

## Approval and shadow scoring

Training only ever produces a CANDIDATE. `approve` binds a named person to the
model's content hash for **shadow scoring only**; editing the model afterwards
voids it. To ship: `git add -f` that one directory in a reviewed PR (see
`apps/ml-service/research/artifacts/README.md`), deploy; the ML service re-reads
approvals every minute. The backend then scores new snapshots, and back-scores
earlier ones, storing the probability beside each. "Approved" does **not** mean
validated and does **not** permit showing a prediction to anyone.

## When is there enough? (`python -m research readiness`)

Volume rules of thumb, in one place (`research/readiness.py`): about 10 events
per candidate predictor to develop (Peduzzi 1996; Riley et al., BMJ 2020, give the
better per-model calculation once a real model exists), and at least 100 events
(and 100 non-events) in separate data to validate (Collins et al., Stat Med 2016).
With 38 predictors that is ~380 events to develop plus 100 to validate; the report
shows your count, the shortfall and a rough ETA at the recent rate. **Volume is
necessary, not sufficient:** the report also warns on poor representation (sex,
age) and short follow-up, and you still need a representative cohort,
adequate outcome ascertainment and external or prospective validation.

## Before any prediction reaches a person (not built, deliberately)

This pipeline ends at "a candidate that has been silently compared with what
happened". Showing a risk flag to a clinician or patient is a different step that
needs, at least: ethics-committee approval; a pre-specified prospective
validation; a regulatory decision on whether the software is a medical device
(SAHPRA; get advice before, not after); clinical sign-off following
`docs/CLINICAL_SIGNOFF_CHECKLIST.md`; an alerting policy that limits alert
fatigue; and the rule the live system already follows, that a model may raise
urgency but never lower it. None of that is implied by anything here.

## Not done / open decisions

- **Clinician outcome-entry UI.** Only the API exists; without it, labels come only from triage.
- **Legal and ethics review of the consent wording and the privacy-policy section.** Drafted from what the code does; not reviewed by a lawyer or ethics committee. The Information Officer should decide the POPIA basis for secondary research use of health information.
- **Retention.** No automatic expiry. Decide a period (and whether to re-ask consent) and add a deletion job.
- **Per-reading capture of non-wearable history, labs and medications.** Only what `BiometricReading` and the risk profile hold is captured. Adding lab values or a coded medical history will help more than any modelling change.
- **Province / language / urban-rural** are not captured (they would increase re-identification risk); the representativeness warnings therefore cover sex and age only.
- **Scale.** Dataset building is a plain Python loop (about 10k rows/second). Fine into the hundreds of thousands of rows; vectorise before millions.
- **Integration with the live engine:** `engine.py` is untouched by design.

## Tests

Backend unit and integration: `pseudonym`, `researchFeatures`, `researchOutcomes`, `researchCapture`
(mocked), `researchPipeline.integration` and `researchShadow.integration` (real
Postgres), `research-db-role.integration`. ML service: `tests/test_research_*.py`
(features, dataset rules, artifacts and approval gate, training and metrics, the
HTTP API, triage agreement, readiness, CLI). The outcome vocabulary is pinned on
both sides by a contract test. Frontend: `ResearchConsentSettings.test.tsx`.
