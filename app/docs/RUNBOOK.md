# Parakh operations runbook

For the person on call (today: one developer). Short, concrete, and honest about what has not been tried yet. Items marked **NOT YET DRILLED** were written from the code and Terraform but never run end to end; do them once on staging before you depend on them.

## 1. Where things live

| Thing                    | Where                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web (static site)        | S3 bucket behind CloudFront. Built and uploaded by the `web` job of the **Deploy production** workflow.                                                                                               |
| API                      | Docker containers on one EC2 host, started by `docker compose` (`infra/deploy/docker-compose.yml`: `caddy` and `api`). App files are in `/opt/parakh` on the host.                                    |
| Database                 | RDS Postgres 16, single instance, **not Multi-AZ**, not publicly reachable. Automated backups, 7 days by default (`db_backup_retention_days`), nightly window 01:30–02:30 IST.                        |
| App settings and secrets | SSM Parameter Store, one parameter per setting: `/parakh/<environment>/<NAME>` (for example `/parakh/production/JWT_ACCESS_SECRET`). `deploy.sh` copies them into `/opt/parakh/.env` on every deploy. |
| Database password        | AWS Secrets Manager (RDS-managed). `deploy.sh` reads it; never put it in SSM.                                                                                                                         |
| Images                   | ECR, tagged with the git commit SHA.                                                                                                                                                                  |
| Mail                     | Amazon SES. Bounce notices arrive at a secret URL guarded by `SES_EVENTS_KEY`.                                                                                                                        |
| Payments                 | Razorpay. **Never set `ALLOW_FAKE_PAYMENTS` in production.**                                                                                                                                          |

Region is `ap-south-1`. Terraform state is configured in `infra/terraform/backend.hcl`; per-environment values are in `infra/terraform/envs/`.

## 2. Is it up? (first five minutes of any incident)

1. `GET <api-host>/health` → `{"status":"ok","database":"ok"}`. It answers **503** with `"database":"unreachable"` when the database cannot be reached, so a health check or alarm can use the status code.
2. Open an SSM session to the app host (EC2 console → Connect → Session Manager), then:
   ```bash
   cd /opt/parakh
   docker compose --env-file .deploy.env ps
   docker compose --env-file .deploy.env logs --tail=100 api
   ```
3. In production the API writes **one JSON line per request** (`reqId`, `method`, `path`, `status`, `ms`, `userId`) and one `unhandled error` line (with stack) for every unexpected 500. Query strings, bodies, headers and IP addresses are never logged. Every response carries an `x-request-id` header: ask the person who hit the error for it and search the logs for that id.
4. Check Razorpay and SES only after the API and database are confirmed healthy.

### Sentry error reporting

- Set `SENTRY_DSN` in `/parakh/<environment>/` in SSM for the API. Set `NEXT_PUBLIC_SENTRY_DSN` in the GitHub deployment environment for the static web build. Use the DSN from each Sentry project. Deploy both services after changing these values.
- The API reports unexpected request exceptions. The browser reports uncaught errors, unhandled rejections and errors caught by the app's React boundaries. Events carry the deployment environment and commit. Payloads keep exception types and application stack locations. They omit exception messages, request data, user context and breadcrumbs.
- To verify after deployment, run the command below inside the production API container from the app directory. Confirm the returned event ID under the API project in Sentry. In the production site browser console, run `setTimeout(() => { throw new TypeError('Staging smoke check'); }, 0)`. Confirm a browser event with the production environment and current release in the web project.

  ```bash
  node -e 'const s=require("./dist/common/sentry"); const id=s.captureApiException(new Error("Staging smoke check")); require("@sentry/node").flush(5000).then(ok=>{ if (!id || !ok) process.exitCode=1; else console.log(id); })'
  ```

## 3. Deploy

Normal path: merge to `main` → **CI** passes → run **Deploy production** by hand from the Actions tab (web to S3 and CloudFront, API image to ECR, then `deploy.sh` on the host over SSM). `deploy.sh` runs `prisma migrate deploy` **before** starting the new version; a failed migration stops the deploy and leaves the running version alone. It then waits up to 60 seconds for `/health` to report the database `ok`.

The coding-submission migration preserves old judging records in PostgreSQL at `archive."CodeSubmission"`. The API no longer queries those records.

Watch the run in the GitHub Actions tab. The image build normally takes about 5 minutes. If it has run past 10 minutes it is stuck: cancel it, wait for it to show cancelled, then **Re-run all jobs**.

Deploys are manual only: there is no automatic trigger, and the `production` environment can require a reviewer.

## 4. Roll back

Code: open the last good **Deploy production** run in GitHub Actions and **Re-run all jobs**. A re-run builds and deploys that run's commit, not the latest one.

**Database changes do not roll back.** Migrations only go forward. Going back to older code is safe only if the older code tolerates the newer schema. All migrations so far only add columns and tables, with one exception: `20261130100000_exam_status_cleanup` removed unused values from the `ExamStatus` enum. Code from before that migration will **not** run against a database that has had it. If a bad migration is the problem, restore the database (section 7) rather than rolling the code back.

## 5. Refund by hand

Normal path (Admin → Payments): find the payment, press **Refund**, give a reason. This sends the money back through Razorpay, reverses the trainer's share in the ledger, cancels the seat, and emails the payer. Students can also ask for a refund before they start an exam; those requests wait under **Refund requests** on the same page.

- A payment marked **needs refund** was taken but nothing was delivered (for example the exam closed while the student was paying). Refund it the same way.
- If the gateway is down, the refund fails cleanly and the payment stays **captured**; try again later.
- Last resort, only if the admin screen cannot be used: refund in the Razorpay dashboard, then record it so the books match. **NOT YET DRILLED:** there is no admin screen to record an outside refund yet, so this needs a developer to post the ledger reversal. Do not do this casually.
- Check the books afterwards: `GET /admin/finance/ledger` must show `totalPaise: 0` and an empty `unbalancedTransactions`.

## 6. Rotate secrets

Edit the parameter in SSM (`/parakh/<environment>/<NAME>`, type SecureString), then **deploy** (re-run the latest Deploy production run) so `deploy.sh` rewrites `.env` and restarts the containers.

| Secret                                   | Effect of changing it                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `JWT_ACCESS_SECRET`                      | Access tokens signed with the old key stop working at once. Refresh tokens are separate, stored hashed, so browsers renew silently. Safe.                                                                                                                                                                                                                                                        |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Change in Razorpay first, then SSM, then deploy. Payments started before the change may fail. Do it outside exam hours.                                                                                                                                                                                                                                                                          |
| `RAZORPAY_WEBHOOK_SECRET`                | Must match the secret set on the webhook in the Razorpay dashboard. Change both within a minute of each other, or webhooks are rejected meanwhile.                                                                                                                                                                                                                                               |
| `SES_EVENTS_KEY`                         | Also update the SNS subscription URL in AWS.                                                                                                                                                                                                                                                                                                                                                     |
| **`DATA_ENCRYPTION_KEY`**                | **Do not change.** It encrypts trainers' bank account numbers **and** signs every certificate. A new key makes all issued certificates fail verification and all saved bank accounts unreadable. There is no re-signing or re-encryption tool.                                                                                                                                                   |
| **`OTP_SECRET`**                         | Safe **only if `DATA_ENCRYPTION_KEY` is set separately**. If `DATA_ENCRYPTION_KEY` is not set, the code falls back to `OTP_SECRET` for the same two jobs, and changing it breaks certificates and bank accounts. **Before launch, confirm `DATA_ENCRYPTION_KEY` exists as its own SSM parameter in every environment.** Changing `OTP_SECRET` also invalidates any verification codes in flight. |
| Database password                        | Rotated by RDS through Secrets Manager. `deploy.sh` reads the current value on each deploy.                                                                                                                                                                                                                                                                                                      |

If a secret leaked, rotate it; then read `audit` rows and the request logs around the exposure for anything that should not have happened.

## 7. Restore the database

RDS keeps automated backups and allows **point-in-time restore** to any moment inside the retention window. Restoring always creates a **new** instance; it never overwrites the live one.

1. Decide the target time (just before the damage). Note it in UTC.
2. Create the new instance (AWS Console → RDS → the `…-postgres` instance → Actions → Restore to point in time; or the CLI `aws rds restore-db-instance-to-point-in-time`). Use the same subnet group and the same database security group as the live instance, a new identifier such as `<live>-restore`, and no public access.
3. Wait until it is `available`. Connect from the app host (the database is private) and check the data: row counts in `User`, `Payment`, `Attempt`, `LedgerEntry`, and that `GET /admin/finance/ledger` equivalents add up to zero.
4. The deploy takes the database address from `DB_HOST` and its matching Secrets Manager secret from `DB_SECRET_ARN`. Confirm the EC2 app role can read the restored instance's secret. For a round-trip drill, keep the source values and current image tag available for rollback. Wait for active exam attempts to finish, then put the API in maintenance mode with only `GET /health` available and pause background jobs before switching. Deploy against the restored endpoint, check the API's database endpoint and health, then deploy against the source and check both again before reopening the API.
5. Keep the old instance until you are sure; then delete it. Anything written between the restore point and now is lost: tell affected users, and reconcile payments against Razorpay.

Recovery objectives today: data loss up to the last 5 minutes before the failure (point-in-time), and **hours** of downtime, since a restore takes a new instance and a manual switch. There is no standby: the database is single-AZ.

### Restore drill (run once on the former staging environment, since removed)

- [x] Restore staging to a point one hour earlier into a new private instance.
- [x] Connect from the app host and compare main-table counts and ledger totals.
- [x] Point an isolated copy of the deployed API at it and check `/health`.
- [x] Verify sign-in against the restored database.
- [x] Switch staging to it with a normal deploy, confirm `/health`, switch back.
- [x] Delete the temporary restored instance.
- [x] Record restore timing and validation results.

| Date       | Who   | Total time                               | Problems and fixes                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ----- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-22 | Codex | About 10 minutes to restore and validate | Restored PostgreSQL to 03:14:56 UTC on an encrypted, private instance. Compared counts with source rows at the restore point (4 users, 0 payments, 0 attempts, 0 ledger rows). The restored database had 25 applied migrations and no unbalanced transactions. An isolated API using the deployed image reported healthy.                                                                                   |
| 2026-11-22 | Codex | Restore requested at 06:50 UTC           | Restored staging PostgreSQL to 06:46:33 UTC in a separate private instance. An isolated API using the deployed image signed in as the recovered QA student, returned the same account from `/users/me`, rotated the refresh cookie, and rejected it after logout. Removed the QA account from the staging source.                                                                                           |
| 2026-11-23 | Codex | 44 seconds for cutover and switch-back   | Restored the current staging database to 02:08:45 UTC. The shared API used the normal deploy script for both switches and served healthy responses on both endpoints. Source and restored counts matched (2 users, 0 payments, 0 attempts, 0 ledger entries), with 26 applied migrations. Maintenance blocked writes and background jobs were paused on the copy. Public API health passed after reopening. |

## 8. Common problems

| Symptom                                                       | Likely cause and first move                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy hangs at "Build and push the API image"                | Stuck runner (seen once). Cancel, wait for cancelled, re-run.                                                                                                                                                                                                                                                                                                                                       |
| Deploy fails at "Deploy on the server"                        | Read the run log. A failing migration prints from `prisma migrate deploy`. The old version keeps running.                                                                                                                                                                                                                                                                                           |
| `/health` says `database: unreachable` (503)                  | RDS stopped, security group changed, or the secret changed. Check the RDS console, then the app host's `.env`.                                                                                                                                                                                                                                                                                      |
| Students cannot sign in, or get "Too many attempts"           | A whole classroom shares one IP, so the per-IP ceilings are high (see section 10). Look for HTTP 429 in the request log. One student retrying a wrong password is limited to 10 tries a minute for that email on that network, by design; they wait a minute. If many different students are refused, a per-IP ceiling is too low: raise the matching `RATE_LIMIT_*` value (section 10) and deploy. |
| Payments succeed at the gateway but students are not enrolled | Webhook not arriving or failing. Check Razorpay's webhook log, the `WebhookEvent` table, and the secret in section 6. Such payments show as **needs refund** in Admin → Payments.                                                                                                                                                                                                                   |
| No emails                                                     | SES still in sandbox, address bounced, or `MAIL_TRANSPORT` is not `ses`.                                                                                                                                                                                                                                                                                                                            |
| Certificates fail verification after a deploy                 | `DATA_ENCRYPTION_KEY` (or `OTP_SECRET` if the first is unset) changed. See section 6.                                                                                                                                                                                                                                                                                                               |

## 9. Monitoring status

| Item                                                         | Status                                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health` checks the database and returns 503 when it cannot | Done                                                                                                                                                                                        |
| Structured request log with request ids                      | Done                                                                                                                                                                                        |
| Unexpected errors logged with stack and request id           | Done                                                                                                                                                                                        |
| Error tracking service (Sentry) on API and web               | Wired in code but off on purpose (paid service; students report problems themselves). Set the DSNs in Sentry error reporting above to turn it on.                                           |
| CloudWatch alarms                                            | Seven alarms on staging. EC2, RDS, and API 5xx alarms are in `ap-south-1`. The Route 53 HTTPS check for `/health` reports to the API health alarm in `us-east-1`. See Staging alarms below. |
| Uptime check from outside AWS                                | Not done.                                                                                                                                                                                   |

### Alarms (the removed staging environment had these; production monitoring is not set up yet)

Terraform defines the alarms and SNS topics in `infra/terraform/monitoring.tf`. Infrastructure alarms publish to `parakh-staging-infra-alarms` in Mumbai. The API health alarm publishes to `parakh-staging-api-health-alarms` in N. Virginia. Each email subscription requires a separate SNS confirmation.

| Alarm             | Trigger                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| EC2 status        | A failed status check in 2 consecutive minutes                                                                                    |
| EC2 CPU           | At least 80% average CPU in 2 consecutive 5-minute periods                                                                        |
| RDS CPU           | At least 80% average CPU in 5 consecutive minutes                                                                                 |
| RDS free storage  | Below 20% of allocated storage in 3 consecutive minutes                                                                           |
| RDS connections   | At least 63 connections in 3 consecutive minutes. Revisit this threshold if PostgreSQL's current `max_connections` of 79 changes. |
| API 5xx           | At least 5 HTTP 5xx request responses in one minute                                                                               |
| Public API health | Route 53 reports `/health` unhealthy in 2 consecutive minutes. The HTTPS probe expects `"database":"ok"`.                         |

The staging API uses Docker's `awslogs` driver and writes to `/parakh/staging/api` in `ap-south-1`. Logs are retained for 14 days. The metric filter counts completed API request records with statuses `500`–`599`, using `Parakh/staging/API` → `ServerErrors`. The public API health alarm monitors availability separately.

Apply the staging monitoring Terraform before the first deployment with CloudWatch logging so the log group and host permissions exist. To investigate an alarm, run `aws logs tail /parakh/staging/api --region ap-south-1 --since 10m` and correlate `reqId` on the request and error records.

Verified on 2026-11-22. A real staging 404 arrived in the log group. Five labelled synthetic 5xx request records triggered the alarm, which returned to `OK` with SNS notifications enabled. Email actions were paused during the synthetic test.

## 10. Rate limits

Two layers, so one classroom cannot lock itself out and one attacker cannot hurt anyone else:

- **Per account (the real protection):** sign-in and code entry allow 10 tries a minute for one email from one network, so someone guessing a password only blocks themselves, never the real owner on another network and never classmates (other emails). Routes that send an email (register, resend code, forgot password) allow 5 a minute to one address from anywhere, so nobody can flood one person's inbox. Refused requests get HTTP 429 with a `Retry-After` header. Counts live in the API process, so a restart resets them.
- **Per IP (a ceiling):** high on purpose, because a college shares one public IP. Change a value by editing the SSM parameter `/parakh/<environment>/<NAME>` and deploying.

| Parameter                       | Default | Caps (per IP, per minute)                                              |
| ------------------------------- | ------- | ---------------------------------------------------------------------- |
| `RATE_LIMIT_IP_PER_MIN`         | 1200    | Everything not listed below                                            |
| `RATE_LIMIT_LOGIN_IP_PER_MIN`   | 600     | Sign-in, code entry                                                    |
| `RATE_LIMIT_REFRESH_IP_PER_MIN` | 600     | Session renewal (each signed-in browser renews about every 15 minutes) |
| `RATE_LIMIT_SIGNUP_IP_PER_MIN`  | 120     | Routes that send an email                                              |
| `RATE_LIMIT_LOOKUP_IP_PER_MIN`  | 300     | Exam-code lookups                                                      |

Exam routes (start, autosave, submit, proctoring events) are exempt from the IP ceiling and limited to 240 per minute per user instead.

The API must be behind the proxy for this to see real client addresses: `main.ts` trusts one proxy hop (Caddy). If the API were ever exposed without the proxy, every client could appear as the proxy's address.
