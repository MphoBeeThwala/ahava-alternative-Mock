# Security runbook

Step-by-step operations for the security controls in `docs/ENGINEERING_PLAN.md` §38–§39. Written for the person running production, not for developers.

**Contents**
0. [Before anything else: the leaked admin password](#0-before-anything-else-the-leaked-admin-password)
1. [Keeping the encryption key in AWS KMS](#1-keeping-the-encryption-key-in-aws-kms)
2. [The ML service's own database login](#2-the-ml-services-own-database-login)
3. [Mandatory two-factor authentication](#3-mandatory-two-factor-authentication)
4. [Encrypting existing clinical notes](#4-encrypting-existing-clinical-notes)
5. [Emergency-access emails to patients](#5-emergency-access-emails-to-patients)
6. [Rollout order](#6-rollout-order)

**Running the one-off commands.** Each command below runs from your own computer against production, using the Railway CLI to load the service's variables:

```bash
npm i -g @railway/cli
railway login
cd ahava-alternative-Mock
railway link              # choose the project, then the backend service
pnpm install
```

`railway run <command>` then runs `<command>` with the backend's production variables.

From your computer, the database has to be reached through its **public** URL: the internal hostname only resolves inside Railway. Copy it once per terminal session:

```bash
# Railway → Postgres service → Variables → DATABASE_PUBLIC_URL (the owner login)
export DB_PUBLIC='postgresql://postgres:...@...proxy.rlwy.net:PORT/railway'
```

Every command below passes it as both `DATABASE_URL` and `POOLED_DATABASE_URL`, because the scripts prefer the pooled one when it's set. Run these from a trusted machine and close the terminal afterwards: they handle production secrets.

---

## 0. Before anything else: the leaked admin password

Until this change, `apps/backend/src/scripts/manage-admin.ts` contained a fallback admin email (`healthsysadmin@ahavaon88.co.za`) and password, committed to the repository. The fallback is gone now, but **it stays in git history forever**, so treat that password as public:

1. If that password is, or ever was, used for any account, change it now: in the app, or with the recovery command below.
2. If it's reused anywhere else (email, Railway, AWS, a password manager), change it there too.
3. Check the audit log for admin sign-ins you don't recognise.

```bash
# Recovery: set a new password for an admin account (signs out all their sessions)
ADMIN_EMAIL='healthsysadmin@ahavaon88.co.za' ADMIN_PASSWORD='<new long password>' \
  DATABASE_URL="$DB_PUBLIC" POOLED_DATABASE_URL="$DB_PUBLIC" \
  pnpm --filter backend exec tsx src/scripts/manage-admin.ts
```

---

## 1. Keeping the encryption key in AWS KMS

### What this is, in plain terms

The patient data that is encrypted in the database is locked with one 32-byte **data key**: addresses, clinical notes, prescriptions, messages, dispatch locations, 2FA secrets, and access justifications. Today that key sits in Railway as the plain variable `ENCRYPTION_KEY`. Anyone who can read the Railway variables, or a leaked `.env`, or a screenshot, holds the key to every record.

With **envelope encryption**:
- The data key is itself locked by a **master key** that lives inside AWS KMS and can never be exported.
- Railway only ever holds the **wrapped** (locked) data key, `ENCRYPTION_KEY_CIPHERTEXT`, which is useless on its own.
- When the API starts, it asks KMS to unwrap the data key and keeps the result only in memory.
- KMS agrees only for the API's own AWS credentials, and only for this app's key and purpose. It records every request in AWS CloudTrail.
- If you ever suspect a breach, **disable the KMS key**. Nothing can unwrap the data key after that, even with a full copy of the database and every Railway variable.

**Nothing is re-encrypted.** You wrap the *same* data key you already have, so every existing record stays readable.

### What it costs

About US$1 a month per KMS key, plus fractions of a cent for decrypt requests. The API unwraps once per start, not per request.

### Step 1: an AWS account and region

1. Create or sign in to an AWS account. Turn on MFA for the root user. After that, don't use root day to day: create an IAM user for yourself, called the "admin user" below.
2. Pick the **Africa (Cape Town) `af-south-1`** region, so the master key stays in South Africa, which is simplest for POPIA. It's an opt-in region: Account → *AWS Regions* → enable *Africa (Cape Town)*.

### Step 2: create the master key

AWS Console → **Key Management Service** (region `af-south-1`) → *Customer managed keys* → **Create key**:

| Setting | Value |
|---|---|
| Key type | Symmetric |
| Key usage | Encrypt and decrypt |
| Alias | `ahava-patient-data` |
| Key administrators | Your admin user only. Not the app. |
| Key users | Leave empty. The app gets access through its own policy in step 3. |

After it's created:
- **Key rotation** tab → tick *Automatically rotate this KMS key every year*. AWS keeps the old versions, so nothing ever needs re-wrapping or re-encrypting.
- Copy the key's **ARN** (`arn:aws:kms:af-south-1:<account-id>:key/<uuid>`).

### Step 3: a decrypt-only identity for the API

IAM → **Users** → *Create user* `ahava-api-kms` (no console access). Attach an inline policy with your key ARN:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UnwrapAhavaDataKeyOnly",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:af-south-1:<account-id>:key/<uuid>",
      "Condition": {
        "StringEquals": {
          "kms:EncryptionContext:app": "ahava-healthcare",
          "kms:EncryptionContext:purpose": "patient-data-key"
        }
      }
    }
  ]
}
```

This identity can only *unwrap*, only with this key, and only for this app's purpose. It can't encrypt, create keys, or read anything else in your account.

*Security credentials* → **Create access key** → "Application running outside AWS". Save the key ID and secret; you'll paste them into Railway in step 5. Set a reminder to rotate this access key every 90 days (create the new one, update Railway, then delete the old one).

### Step 4: wrap your existing key

On your computer, logged into AWS as your **admin user** (for example `aws configure --profile ahava-admin`), not as `ahava-api-kms`, which can't encrypt:

```bash
# Current key from Railway (backend service → Variables → ENCRYPTION_KEY)
export ENCRYPTION_KEY='<paste current value>'
export ENCRYPTION_KMS_KEY_ID='arn:aws:kms:af-south-1:<account-id>:key/<uuid>'
export AWS_REGION=af-south-1 AWS_PROFILE=ahava-admin
pnpm --filter backend wrap-encryption-key
unset ENCRYPTION_KEY
```

It wraps the key, unwraps it again to check the result matches, then prints `ENCRYPTION_KEY_CIPHERTEXT=...`.

If you also have `ENCRYPTION_KEY_PREVIOUS` set (from an earlier rotation), run it again with `ENCRYPTION_KEY_PREVIOUS=...` and `--previous`.

### Step 5: switch Railway over

Backend service → **Variables**:

| Add | Value |
|---|---|
| `ENCRYPTION_KEY_PROVIDER` | `aws-kms` |
| `ENCRYPTION_KEY_CIPHERTEXT` | from step 4 |
| `ENCRYPTION_KMS_KEY_ID` | the key ARN |
| `AWS_REGION` | `af-south-1` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | from step 3 |

Then **delete `ENCRYPTION_KEY`** (and `ENCRYPTION_KEY_PREVIOUS`, if present) and deploy. Leave `ENCRYPTION_KEY_ID` / `ENCRYPTION_KEY_PREVIOUS_ID` as they are.

The API refuses to start while a plaintext key is still set alongside `aws-kms`. That's deliberate, so the plaintext copy can't linger.

**Check it worked:**
1. The deploy log shows `[keys] Data key unwrapped via AWS KMS`.
2. The app still shows addresses and notes.
3. CloudTrail (region `af-south-1`) shows a `Decrypt` event from `ahava-api-kms`.

If it fails, the API doesn't start. Put `ENCRYPTION_KEY` back and set `ENCRYPTION_KEY_PROVIDER=env` to roll back, then fix and retry.

### Step 6: decide about a sealed backup of the data key

If the KMS key is ever deleted, every encrypted record is gone for good. AWS makes you wait 7–30 days before deletion; set it to 30. You can also keep one **offline, sealed copy** of the plaintext data key: for example in a password-manager vault that needs two people to open, or printed and kept in a safe.

- **With a sealed copy:** you can recover from a lost AWS account, but the copy has to be protected like the data itself.
- **Without one:** you rely entirely on AWS KMS durability and your AWS account's security.

This is a business decision. Record whichever you choose, and who holds it.

### Ongoing

- **Master-key rotation:** automatic, yearly. Nothing to do.
- **Watch the key:** optionally, a CloudWatch alarm on KMS `Decrypt` calls from anyone other than `ahava-api-kms`.
- **Suspected compromise of the data key itself:**
  1. Generate a new data key with `aws kms generate-data-key --key-spec AES_256` and the same encryption context, or wrap a fresh random key with the script.
  2. Set it as `ENCRYPTION_KEY_CIPHERTEXT` with a new `ENCRYPTION_KEY_ID`.
  3. Move the old one to `ENCRYPTION_KEY_PREVIOUS_CIPHERTEXT` / `ENCRYPTION_KEY_PREVIOUS_ID`.
  
  New data then uses the new key and old data stays readable. There is no bulk re-encryption tool yet, so the old key must stay configured as "previous" until one is written.

---

## 2. The ML service's own database login

The ML service used the database owner's login, which can read everything: triage notes, messages, password hashes, audit logs. It now gets a login that can only:
- read and add rows in its own vitals table, `biometric_time_series`
- read and update the `riskProfile` column of `users`

It can't read anything else in `users`, touch any other table, delete history, or change the schema.

```bash
# 1. Create the login, using the OWNER connection (Postgres service → DATABASE_PUBLIC_URL)
ML_DB_PASSWORD='<new long random password>' DATABASE_URL="$DB_PUBLIC" \
  pnpm --filter backend ml-db-role
```

It creates the table if needed, creates the `ahava_ml` login with only those grants, then signs in *as* `ahava_ml` and checks 11 things: 4 it must be able to do, 7 it must be refused. Every line should say `PASS`.

If you leave out `ML_DB_PASSWORD`, it generates a strong password and prints it once.

2. Railway → **ML service** → Variables → set `DATABASE_URL` to the internal URL with the new login. Take the backend's internal `DATABASE_URL` and replace the username and password with `ahava_ml` and the new password. Deploy.
3. The ML service log should show `biometric_time_series present; skipping schema setup`.

**Other commands:**
- Re-check at any time: add `--verify-only`.
- Change the password: run step 1 again with a new `ML_DB_PASSWORD`, then update the ML service's variable.
- Retire the login: `--drop`.

If the "no DDL" check fails, your Postgres is older than version 15, where every login may create tables by default. As the owner, run `REVOKE CREATE ON SCHEMA public FROM PUBLIC;`, then run the check again.

---

## 3. Mandatory two-factor authentication

Nurse, doctor and administrator accounts must use an authenticator app. Patients may choose to.

**What staff see:**
- **At their next sign-in:** a "Secure your account" page. Until they set up 2FA, their session can reach nothing else.
- **During setup:** they scan a QR code, enter a code, and are shown 10 one-time backup codes. They must keep the codes somewhere safe.
- **After setup:** every sign-in asks for a code. Staff can't switch 2FA off.

**Tell staff before you deploy:** they'll need Google Authenticator, Microsoft Authenticator or Authy on their phone.

**Lost phone and backup codes:**
1. Confirm the person's identity out of band, for example a call to a number you already have on file.
2. Another admin opens *Admin dashboard → Reset 2FA* and gives a reason, which is recorded.
3. The person is signed out everywhere and sets 2FA up again at their next sign-in.

Admins can't reset their own 2FA.

**The only admin lost their phone.** Nobody can reset it in the app, so use infrastructure access:

```bash
ADMIN_EMAIL='<admin email>' DATABASE_URL="$DB_PUBLIC" POOLED_DATABASE_URL="$DB_PUBLIC" \
  pnpm --filter backend exec tsx src/scripts/manage-admin.ts --reset-2fa
```

Good practice: always have **at least two admins**, so this is never needed.

---

## 4. Encrypting existing clinical notes

New notes are encrypted automatically. Notes written before this change are still plaintext until you run the backfill **once, after deploying**. It needs the same key source as the API, so it can use either the plain key or the KMS variables.

```bash
# railway run supplies the key variables (ENCRYPTION_KEY, or the KMS ones); env points it at the public DB URL.
railway run -- env DATABASE_URL="$DB_PUBLIC" POOLED_DATABASE_URL="$DB_PUBLIC" pnpm --filter backend encrypt:clinical-notes          # report only
railway run -- env DATABASE_URL="$DB_PUBLIC" POOLED_DATABASE_URL="$DB_PUBLIC" pnpm --filter backend encrypt:clinical-notes --apply  # encrypt
```

It's safe to repeat: a second run should report `0 field(s)`.

---

## 5. Emergency-access emails to patients

When a clinician uses emergency (break-glass) access, the patient gets an email at their registered address. It says who opened the record (name, nurse or doctor, SANC or HPCSA number), when, and when access ends, with a link to their access history. It doesn't include the clinician's written reason; admins see that in the review.

It needs these on the backend:
- `RESEND_API_KEY`, the existing email provider
- `FRONTEND_URL`, for the link

Without `RESEND_API_KEY` the email is skipped, and the access still shows in the patient's in-app history.

---

## 6. Rollout order

1. **Now:** rotate the leaked admin password (section 0). Make sure there are at least two admin accounts.
2. **Tell staff** about 2FA, then deploy. Migrations run automatically on backend start.
3. **Each admin signs in and sets up 2FA first.** Then verify staff SANC/HPCSA registrations in the admin dashboard; unverified clinicians can't reach patient data.
4. Run the notes backfill (section 4).
5. Create the ML login and switch the ML service over (section 2).
6. Move the key into KMS (section 1). You can do this independently of the steps above, in a quiet period.
