# Triage Demo Pack

Use these files to run a full fictional triage case in the app.

## Patient Passport

Set the patient profile to:

- Age: `29`
- Sex: `Female`
- Chronic conditions: `Asthma`
- Allergies: `Penicillin`
- Current medications: `Salbutamol inhaler as needed`
- Pregnancy: `Not pregnant`

## Symptoms To Paste

Use the contents of `symptoms.txt`.

## Files To Upload

- `throat-infection-demo.svg`
  - Upload as the symptom image
- `lab-results-demo.svg`
  - Upload as the lab result / investigation file

## Suggested Doctor Follow-Up

Before I complete the review, please confirm whether you have taken any antibiotics in the last 7 days, whether you have any medication allergies beyond penicillin, and upload any recent throat swab or inflammatory marker results if available.

## Safety Check Demo

To test the prescribing guardrails:

1. Leave allergies/current meds incomplete and try prescribing `Amoxicillin`
2. Confirm the system raises blockers or warnings
3. Update the passport fields above
4. Retry with `Azithromycin`
