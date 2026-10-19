# Backups and alerting

Two questions this answers: **"if the database is lost, can we get patients' data back?"** and **"if the app goes down, who finds out, and how fast?"**

## 1. Alerting (already built; needs two minutes of setup)

`.github/workflows/uptime.yml` runs `scripts/prod-smoke.js` against production every 15 minutes. It is read-only. When a check fails, the run fails and GitHub emails everyone watching the repository's Actions.

One-time setup (GitHub: Settings > Secrets and variables > Actions):

| Kind | Name | Value |
|---|---|---|
| Variable | `BACKEND_URL` | the backend's public URL, no trailing slash |
| Variable | `FRONTEND_URL` | the frontend's public URL |
| Variable | `ML_URL` | the ML service's public URL (optional) |
| Secret | `ML_SERVICE_SHARED_SECRET` | same value as on the ML service (optional) |

Then make sure the right people get the email: GitHub > profile > Settings > Notifications > "Actions" > tick "Send notifications for failed workflows only". Add a second person as a repository watcher so an alert is not seen by one inbox only.

What it catches: app or database down (`/ready`), backend unreachable from the frontend, a protected route that stopped refusing anonymous callers, the ML service down or its key rejected. What it does not catch: slow degradation, a wrong clinical answer, a third-party outage that only affects some users.

Add a second, independent watcher so one provider failing does not silence everything: a free account on an external uptime monitor (for example UptimeRobot or Better Stack) pointed at `GET <backend>/ready` and `GET <frontend>/`, alerting by SMS or phone call as well as email. `/ready` returns 503 when the database is unreachable, which is exactly the signal wanted.

Also watch the AI triage health shown in the admin dashboard: a provider outage does not make the app "not ready" (by design) but it does mean cases are waiting for a human.

## 2. Backups

**Check first what Railway already does** (Railway > the Postgres service > Backups). Railway's automatic scheduled backups are a paid-plan feature; on a plan without them there is no backup unless you make one. Turn on daily and weekly schedules if the option exists. These stay inside Railway, so they protect against mistakes and bad deploys, not against losing the Railway account or project itself. Keep a second copy elsewhere (below).

### Weekly off-platform copy (do this from your own computer or a server you control)

Patient health data must not be stored in GitHub, in CI artifacts or in a chat. Keep the copy encrypted and outside the repository.

```bash
# Needs PostgreSQL client tools. DATABASE_URL = the Railway "public" connection string.
pg_dump --format=custom --no-owner "$DATABASE_URL" -f ahava-$(date +%F).dump
# Encrypt before it leaves your machine (age or gpg); keep the key somewhere other than the backup.
age -r <your-age-public-key> -o ahava-$(date +%F).dump.age ahava-$(date +%F).dump && rm ahava-$(date +%F).dump
```

Store the `.age` file in storage you control (an encrypted external drive, or a private bucket with versioning). Keep the last 4 weekly and 3 monthly copies, and delete older ones.

### The part that is easy to forget: the encryption key

Clinical notes and other sensitive fields are encrypted by the application with `ENCRYPTION_KEY` (see `docs/SECURITY_RUNBOOK.md`). A database backup **without that key restores unreadable data**. Store the key separately from the backups, in at least two places (for example a password manager and a printed copy in a safe). Losing both the key and the key's backup means the encrypted fields are gone for good.

### Restore drill (do it once now, then every quarter)

A backup nobody has restored is a guess. On a throwaway database, never production:

1. Create an empty local database: `docker run --rm -d -p 5440:5432 -e POSTGRES_PASSWORD=pw postgres:16` (or any scratch Postgres).
2. Decrypt and restore: `pg_restore --no-owner -d postgresql://postgres:pw@localhost:5440/postgres ahava-YYYY-MM-DD.dump`.
3. Point a local backend at it with the real `ENCRYPTION_KEY` and check you can read a test patient's record.
4. Write down how long it took and what you had to look up. That number is your real recovery time.

### Recovery targets to agree on

- **How much data can we lose?** With daily backups, up to 24 hours. If that is too much, Railway's point-in-time recovery or more frequent dumps are the answer.
- **How long can we be down?** The drill above gives the honest number.

## 3. Incident basics

If `/ready` fails: check Railway's status page and the service logs, then the database service. If a bad deploy caused it, redeploy the previous one first and investigate after. Anything involving patient data being exposed has legal reporting duties (POPIA); see `docs/SECURITY_RUNBOOK.md`.
