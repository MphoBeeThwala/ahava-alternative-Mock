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
| Rows kept at most 7 years; people inactive for 24 months removed; settings bounded against typos | `researchRetention.ts` |
| Sign-up opt-in is unticked and optional, recorded atomically with the account; staff cannot be enrolled | `routes/auth.ts`, `signup/page.tsx` |
| A weak (remote-triage) diagnosis is marked and can be excluded from training; a corrected code replaces the earlier one | `researchCapture.ts`, `research/dataset.py` |
| "Useful" and "false alarm" for one patient and day cannot both stand | `researchCapture.ts` |
| A patient can see and download their own kept data; model scores are never shown, only counted | `GET /research/my-data`, `ResearchConsentSettings.tsx` |
| Doctors are informed (not asked) how their decisions are used; only their role is stored | `ClinicianResearchNotice.tsx` |

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
3. Nothing is captured until a patient opts in. There are three ways to say yes, all the same wording
   (`workspace/src/components/ResearchConsentCopy.tsx`, the only place to edit it): an **unticked, optional checkbox
   at sign-up** (also honoured if they then use Google sign-up); a **one-time prompt on the dashboard** for anyone
   who has not answered (Google sign-ups, accounts a nurse or administrator created, earlier sign-ups; "Not now"
   hides it for 30 days on that device and nothing is stored server-side); and the **Profile page**, where they can
   also withdraw and see what has been kept. A withdrawal is an answer and is never asked again. An agreement on
   older wording is not current, so those people are asked again. Check accrual:
   `GET /api/v1/admin/research/status` (counts only), shown as a card on the admin dashboard.
4. `RESEARCH_CAPTURE_ENABLED=false` switches capture off without removing the key.

`RESEARCH_RETENTION_MAX_YEARS` (7) and `RESEARCH_RETENTION_INACTIVE_MONTHS` (24), `RESEARCH_SWEEP_INTERVAL_MS` (default 900000), `RESEARCH_SHADOW_ENABLED` (default on,
and a no-op until a model is approved) tune the rest. See `apps/backend/env.example`.

## Recording outcomes (the part that decides whether this is ever useful)

A model is only as good as its labels. Readings without outcomes teach nothing. Four sources, from least to most effort
for a doctor, and one rule above them all:

**"The doctor agreed with the AI" is never stored as the truth.** Doctors tend to accept what the AI shows them, so
treating acceptance as a label would teach a model to copy the AI and its mistakes while the numbers improved. Agreement
is kept as its own measurement (below) and nothing else.

1. **Automatic, nothing asked of the doctor:** when a doctor releases a result, issues a prescription or a referral, the
   AI's level and the final level are recorded (`TRIAGE_REVIEWED`, including "accepted unchanged"), plus
   `EMERGENCY_REFERRAL`. This is a *measurement of the AI* (`python -m research triage`), not a training label.
2. **A code the doctor already types:** an optional ICD-10 field on the prescription and referral forms (format-checked,
   stored on the clinical record). A code that clearly means hypertension (I10-I15), diabetes (E10-E14), a cardiovascular
   event (I21, I22, I46, I50, I60-I64, G45) or an arrhythmia (I47-I49) is recorded silently as an outcome, marked
   `REMOTE_TRIAGE`: **diagnosed remotely, without an examination or test, so a weaker label.** Correcting or removing the
   code replaces what the earlier one recorded. `--strong-labels-only` leaves these out of training, and the readiness
   report shows what share of events are weak.
3. **One click on an alert:** "Real concern" / "False alarm" on each monitored patient (`ALERT_CONFIRMED` /
   `ALERT_DISMISSED`). Only an explicit answer is recorded, never "the doctor opened it"; a changed answer replaces the
   earlier one.
4. **A short panel for later events** on the clinician's patient record (doctors only): hospital admission, a diagnosis
   made elsewhere, a cardiovascular event, a death. These arrive weeks or months after any triage case, so they cannot be
   inferred from one, and they are the strongest labels there are (`POST /api/v1/research/outcomes`, structured fields
   only, no free text).

Negatives are only as reliable as outcome recording: a patient with no recorded outcome is counted as event-free once
follow-up has elapsed. If outcomes are not recorded, the data will say everyone is healthy.

**Doctors are told, not asked.** A notice on the doctor dashboard, monitoring page and patient record explains what is
recorded, that only their *role* is stored (not their name), that they cannot opt a patient in or out, and that it never
changes their decision or reaches patients. The privacy policy says the same.

**Who can see what.** Nobody can view research rows: they are coded precisely so they cannot be linked back. Admins see
counts and who recorded outcomes (from the audit trail). A patient sees **their own** kept data (readings and outcomes) on
their Profile page and can download it; model scores are shown to them as a **count only**, never a number, because they
come from unvalidated models and a risk figure would be the clinical claim this pipeline deliberately does not make.

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

## Retention

Two rules run once a day (`researchRetention.ts`), audited with counts only:

1. **No row is kept longer than 7 years** (`RESEARCH_RETENTION_MAX_YEARS`). Validating a risk model takes years of follow-up
   (the diabetes target alone needs 365 days before a negative can be called), so the limit has to be generous; 7 years sits
   above the 5-year health-record norm without keeping anyone's data indefinitely (POPIA s14: no longer than the purpose needs).
2. **A person with no new reading or outcome for 24 months is removed entirely**
   (`RESEARCH_RETENTION_INACTIVE_MONTHS`). Someone who has gone quiet is no longer contributing to the purpose, and their
   agreement is likely stale. If they are still opted in and send readings again, capture restarts from that day.

The settings are bounded so a typo cannot become "delete everything": plain whole numbers only, floors of 1 year and 6
months, anything else falls back to the default with a warning, and the only way to switch a rule off is the word `off`.
Predictions go with their readings, consent records are never touched, and the admin card shows the policy in force and when
it last ran. These are defaults chosen by engineering for the stated purpose; the Information Officer can change them by
changing the two environment variables, no code needed.

**Proposed wording for the privacy policy** (not yet added, because the policy text is legal text and needs your legal
adviser's nod first): *"Research data is kept for at most seven years, and is deleted sooner if you have had no new readings or
outcomes for two years, or if you withdraw."*

## Decisions recorded and what is still open

- **Wording approved** by Ahava's legal adviser and Information Officer. Legal's later confirmation that the wording is
  sound was given in reply to the question about the sign-up and dashboard placement (relayed by the project owner,
  2026-10-06); it names the wording, not the placement, so if the placement ever needs its own sign-off, ask for that. The wording is unchanged, so the consent version
  stays `1.0`; change both copies of the version together if the text ever changes materially.
- **Unvalidated model scores** are shown to a patient as a count only. A request for the scores themselves is handled case by
  case through a request for information to the Information Officer (owner's decision, 2026-10-06).
- **Ethics.** The owner confirms the ethics position meets the legal requirements. No ethics-committee approval reference is on
  file; if a journal, regulator or partner later asks for one, that is where to look.
- **Retention** decided by engineering as above.
- **Nurse follow-up outcomes: deliberately left open.** Outcome recording is for doctors only; home-visit findings are not
  captured. To be decided later.
- **Prompt snooze is per device.** "Not now" is remembered in the browser for 30 days; deliberately nothing is stored
  server-side about a "no".
- **Captured only if a patient has readings.** Only what `BiometricReading` and the risk profile hold is captured. Adding lab
  values or a coded medical history will help more than any modelling change.
- **Province / language / urban-rural** are not captured (they would raise re-identification risk), so representativeness
  warnings cover sex and age only.
- **Scale.** Dataset building is a plain Python loop (about 10k rows per second, measured). Fine into the hundreds of
  thousands of rows; vectorise before millions.
- **Integration with the live engine:** `engine.py` is untouched by design.

## Tests

Backend unit and integration: `pseudonym`, `researchFeatures`, `researchOutcomes`, `researchCapture`
(mocked), `researchPipeline.integration` and `researchShadow.integration` (real
Postgres), `research-db-role.integration`. ML service: `tests/test_research_*.py`
(features, dataset rules, artifacts and approval gate, training and metrics, the
HTTP API, triage agreement, readiness, CLI). The outcome vocabulary is pinned on
both sides by a contract test. Frontend: `ResearchConsentSettings`, `ResearchConsentPrompt`, `ResearchSettingsMyData`, `ClinicianComponents` (ICD-10 field, alert feedback, outcome recorder, doctor notice, admin card) and the sign-up page (`signup/page.test.tsx`). Backend integration also covers sign-up opt-in, diagnosis codes through the real referral and prescription routes, the patient's own view and the admin per-clinician counts (`researchCapturePaths.integration.test.ts`).
