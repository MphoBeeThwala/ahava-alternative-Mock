# Synthea Integration for Ahava Healthcare MVP — Report

**Purpose:** Use [Synthea](https://github.com/synthetichealth/synthea) (open-source synthetic patient generator) to produce realistic, research-grade patient data for the Ahava MVP: demographics, medical history, and biometrics, with outputs in CSV and FHIR suitable for seeding and API testing.

---

## 1. What Synthea Gives You

| Output | Use in Ahava |
|--------|----------------|
| **Complete medical history** | Conditions, medications, allergies, procedures — for future clinical modules and reporting. |
| **Biometrics (vitals)** | Height, weight, BP (systolic/diastolic), heart rate, SpO2, temperature, respiratory rate, BMI — maps directly to `BiometricReading` and ML baseline/early warning. |
| **Realistic contacts** | Fake addresses, phone numbers, emergency contacts — for demographics and contact fields. |
| **Formats** | **CSV** → seed PostgreSQL/Prisma; **FHIR (JSON)** → API testing, interoperability, and future FHIR endpoints. |

Synthea simulates patients from birth to death using real-world clinical statistics and generates **patients.csv**, **observations.csv**, **conditions.csv**, **medications.csv**, **allergies.csv**, and more when CSV export is enabled.

---

## 2. How to Run Synthea

### Prerequisites

- **Java JDK 11+** (LTS 11 or 17 recommended).  
  Check: `java -version`  
  **Windows:** If `pnpm run synthea:run-and-seed` says "java is not recognized" even though `java -version` works in your terminal, set **JAVA_HOME** to your JDK root (e.g. `C:\Program Files\Eclipse Adoptium\jdk-11.0.28`) so the script can find Java; or run the seed from the same terminal where `java` works.

### Option A — Run with pre-built JAR (recommended)

1. Download the latest **synthea-with-dependencies.jar** from [Synthea releases](https://github.com/synthetichealth/synthea/releases).
2. Enable CSV (and optionally FHIR) in `synthea.properties` (see below).
3. Run:

```bash
java -jar synthea-with-dependencies.jar [options] [state [city]]
```

**Examples:**

```bash
# Generate 100 patients (default state)
java -jar synthea-with-dependencies.jar -p 100

# Generate 500 patients in a specific state/city
java -jar synthea-with-dependencies.jar -p 500 Massachusetts Boston

# Reproducible run with seed
java -jar synthea-with-dependencies.jar -s 12345 -p 200

# Output to a specific directory (if supported by your JAR version)
# Otherwise output goes to ./output/
```

### Option B — Build from source

```bash
git clone https://github.com/synthetichealth/synthea.git
cd synthea
./gradlew build check test
# Enable CSV in src/main/resources/synthea.properties (see below)
./run_synthea -p 100
```

Output appears under `./output/` (e.g. `./output/csv/`, `./output/fhir/`).

### Enable CSV (and FHIR) export

Edit `src/main/resources/synthea.properties` (in the Synthea repo) or, if using the JAR, create/override a `synthea.properties` file and point to it if the JAR supports it. Set:

```properties
exporter.csv.export = true
exporter.fhir.export = true
```

Then run Synthea. You will get:

- **output/csv/** — `patients.csv`, `observations.csv`, `conditions.csv`, `medications.csv`, `allergies.csv`, etc.
- **output/fhir/** — FHIR R4 Bundle (JSON) per patient.

---

## 3. Mapping Synthea → Ahava Schema

### 3.1 Patients → `User` (PATIENT)

| Synthea CSV (patients.csv) | Ahava `User` |
|----------------------------|--------------|
| Id (UUID) | Stored as external reference; used to join with observations. |
| First, Last | firstName, lastName |
| BirthDate | dateOfBirth |
| Gender (M/F) | gender |
| Address, City, State, Zip | Can populate encryptedAddress or leave for later. |
| (no email in Synthea) | We generate: `synthea_<First>_<Last>_<shortId>@synthea.ahava.test` (unique). |
| (no password) | Shared research password (e.g. `SyntheaPatient1!`), documented. |

### 3.2 Observations → `BiometricReading`

Observations use **LOINC** codes. We map one Synthea “day” (or encounter) of observations to one `BiometricReading` per patient per day.

| LOINC Code | Synthea Description | Ahava Field |
|------------|---------------------|-------------|
| 8867-4 | Heart rate | heartRate, heartRateResting |
| 8480-6 | Systolic BP | bloodPressureSystolic |
| 8462-4 | Diastolic BP | bloodPressureDiastolic |
| 8310-5 | Body temperature | temperature |
| 59408-5 | Oxygen saturation | oxygenSaturation |
| 9279-1 | Respiratory rate | respiratoryRate |
| 8302-2 | Body height | height |
| 29463-7 | Body weight | weight |
| 39156-5 | BMI | (derivable; optional) |

- **observations.csv** columns: Date, Patient (UUID), Encounter, Code, Description, Value, Units, Type.
- We group by **Patient** and **Date** (day), then map **Code** → field and set **createdAt** to the observation date.

### 3.3 Other Synthea Data (future use)

- **conditions.csv** — Diagnoses (SNOMED); for future “problem list” or reporting.
- **medications.csv** — For future medication list or drug–alert checks.
- **allergies.csv** — For future allergy checks and clinical safety.

---

## 4. How We Use It for MVP Research

1. **Demographics and volume**  
   Generate 100–1000+ synthetic patients with realistic names, DOB, gender, and address. Use for load testing and dashboard behaviour.

2. **Biometric history and baselines**  
   Import observations so each patient has a time series of vitals. This feeds:
   - ML baseline and readiness score (e.g. 14+ days of data).
   - Early-warning and alerting behaviour.
   - “Recent readings” and trends in the UI.

3. **FHIR and interoperability**  
   Use FHIR output for:
   - API contract tests (ingest/export).
   - Future FHIR API or integration with other systems.

4. **Conditions and medications**  
   Use for:
   - Risk stratification and reporting.
   - Future features (problem list, med list, allergy checks).

---

## 5. Seed Script: From Synthea CSV to Ahava DB

A script **seed-from-synthea** reads Synthea’s CSV output and seeds the Ahava database:

- **Input:** Path to Synthea CSV directory (e.g. `./output/csv` or `synthea-output/csv`).
- **Output:**
  - `User` rows (role PATIENT) with generated email and shared password.
  - `BiometricReading` rows built from **observations.csv** (grouped by patient + date, LOINC mapped to our fields).

**Usage:**

```bash
# From repo root (CSV path default: ./synthea-output/csv)
pnpm run seed:from-synthea

# Custom path and password
SYNTHEA_CSV_PATH=./output/csv SYNTHEA_PASSWORD='MyResearch1!' pnpm run seed:from-synthea
```

**Environment:**

| Variable | Description | Default |
|----------|-------------|--------|
| `SYNTHEA_CSV_PATH` | Directory containing `patients.csv` and `observations.csv` | `./synthea-output/csv` |
| `SYNTHEA_PASSWORD` | Shared password for all imported Synthea patients | `SyntheaPatient1!` |
| `SYNTHEA_MAX_PATIENTS` | Max number of patients to import (0 = all) | `0` |

After running:

- Log in with e.g. `synthea_John_Doe_<id>@synthea.ahava.test` and the shared password.
- Patient dashboard will show readiness/baseline and recent readings when observations were imported.

**Note:** The seed step uses Prisma and `DATABASE_URL` from `apps/backend/.env`. The database server must be running and reachable (e.g. local PostgreSQL, or network/VPN access to Railway). If you see "Can't reach database server", check `DATABASE_URL` and connectivity, then run `pnpm run seed:from-synthea` again (Synthea CSV in `output/csv` is already there).

---

## 6. End-to-End Workflow for Research

1. **Install Java 11+** and download or build Synthea (JAR or from source).
2. **Enable CSV** (and optionally FHIR) in `synthea.properties`.
3. **Run Synthea:** e.g. `java -jar synthea-with-dependencies.jar -p 500`.
4. **Copy output** into the project, e.g. `cp -r output/csv ./synthea-output/csv` (or set `SYNTHEA_CSV_PATH` to your `output/csv`).
5. **Seed Ahava:** `pnpm run seed:from-synthea` (with optional env vars).
6. **Run backend + ML service**, then **load test** or **early-warning test** using Synthea-derived users.
7. **Inspect** in the UI (patient dashboard, recent readings, alerts) and in the DB.

---

## 7. Limitations and Next Steps

- **Email:** Synthea has no email; we generate a deterministic email per patient. No real emails or SMS.
- **Password:** Single shared password for all Synthea-imported users; suitable only for research/dev.
- **Address:** Synthea address can be stored for context; encryption and consent for production can be added later.
- **One reading per day:** We collapse observations by patient and date; sub-daily granularity is possible with a different grouping strategy.
- **FHIR ingest:** Current seed is CSV-based; a separate FHIR Bundle → User + BiometricReading pipeline can be added for API-driven testing.

**Recommended next steps:**

- Add optional **conditions**/medications import to support risk and reporting.
- Add a **FHIR Bundle** importer for API and interoperability testing.
- Document Synthea run (and CSV path) in CI or a “research data” README for reproducibility.

---

## 8. Quick reference

| Step | Command / action |
|------|-------------------|
| Get Synthea | Download [synthea-with-dependencies.jar](https://github.com/synthetichealth/synthea/releases) or clone and `./gradlew build`. |
| Enable CSV | In `synthea.properties`: `exporter.csv.export = true`. |
| Generate data | `java -jar synthea-with-dependencies.jar -p 500` (output in `./output/csv/`). |
| Seed Ahava | Copy `output/csv` to `synthea-output/csv` (or set `SYNTHEA_CSV_PATH`), then `pnpm run seed:from-synthea`. |
| Log in | Email: `synthea_<First>_<Last>_<id>@synthea.ahava.test`, password: `SyntheaPatient1!` (or `SYNTHEA_PASSWORD`). |

---

## 9. References

- [Synthea GitHub](https://github.com/synthetichealth/synthea) — source and releases (e.g. **synthea-with-dependencies.jar**).
- [Synthea Wiki — CSV File Data Dictionary](https://github.com/synthetichealth/synthea/wiki/CSV-File-Data-Dictionary) — column definitions for patients, observations, conditions, etc.
- [Synthea Wiki — Common Configuration](https://github.com/synthetichealth/synthea/wiki/Common-Configuration) — exporters and options.
- [LOINC](https://loinc.org/) — observation codes (e.g. 8480-6, 8462-4, 8867-4) for vitals mapping.
