# AssessIQ → Parakh rename: safe plan

Status: EXECUTED on staging on 2026-11-22 (Option C: everything renamed). Kept as a record. The old tfstate bucket `assessiq-tfstate-143920986615` and RDS snapshot `pre-parakh-rename-20261122` were deleted on 2026-11-23, so the old staging data cannot be restored.

## What the scan found

- 256 text hits in 129 files (`assessiq` in code, CI, Terraform, docs).
- GitHub: repo `devxjitin/assessiq` (remote `origin`). Terraform `staging.tfvars` pins the GitHub deploy role to this repo name AND an immutable OIDC subject (`devxjitin@292993567/assessiq@1460239934`).
- Live AWS (ap-south-1, staging): EC2 `assessiq-staging-app`, RDS `assessiq-staging-postgres` (db `assessiq`, user `assessiq_admin`), ECR `assessiq-staging-api` / `assessiq-staging-worker`, S3 `assessiq-staging-files-…`, `assessiq-staging-web-…`, `assessiq-tfstate-…`, 13 SSM params under `/assessiq/staging/`, log group `/assessiq/staging/api`, 6 CloudWatch alarms, IAM roles `assessiq-staging-app` and `assessiq-staging-github-deploy`.
- URLs: staging is already on `parakh.nandivex.in` (see `infra/DOMAIN_MOVE.md`). Production is not applied yet.
- Code: npm scope `@assessiq/*` (api, web, worker, shared, question-parser), root package `assessiq`, `Dockerfile`, `/opt/assessiq` on the server, docker image names, folder `assessiq/`.

## Two things that must NOT change (they would break data or sessions)

1. `apps/api/src/common/crypto.ts:4` HKDF salt `'assessiq'` — encrypts payout details. Changing it makes stored payout data unreadable. Keep forever (add a comment that it is a legacy constant, not a brand).
2. `apps/api/src/auth/tokens.service.ts:10` JWT `ISSUER = 'assessiq'` — changing it logs everyone out. If changed, accept both issuers for one token lifetime, then drop the old one.

## Cannot be renamed in place on AWS (rename = create new + migrate)

S3 buckets, ECR repos, SSM parameters, CloudWatch log groups and alarms, IAM roles, RDS identifier (rename causes a restart and new endpoint). Postgres database name and user (`assessiq`, `assessiq_admin`) are the riskiest: leave them.

## Phases (each phase is independently shippable and has a rollback)

### Phase 0 — Safety net (before anything)

- Manual RDS snapshot `pre-parakh-rename`; copy Terraform state file from the tfstate bucket; `git tag pre-parakh-rename` and a full backup zip of the project folder.
- Create branch `parakh-rename`. Confirm CI is green on `main` first.
- Freeze: no deploys from other branches during the rename.

### Phase 1 — Code and docs (user-visible and dev-visible names, low risk)

- UI text, emails, README, plan docs, `PROJECT_OVERVIEW`, page titles: AssessIQ → Parakh (the legacy Exam Hall app is untouched).
- npm scope `@assessiq/*` → `@parakh/*` in all `package.json`, imports, `package-lock.json` (regenerate), `Dockerfile`, workspace scripts, CI `-w` flags.
- Local CI-only names: Postgres test user/db in `ci.yml` and local `infra/docker-compose.yml` can become `parakh` (test-only, safe).
- Do NOT touch: HKDF salt, JWT issuer (see above), production DB name/user.
- Gate: `npm ci`, build, all tests (313+ API tests) pass; `grep -ri assessiq` shows only the allow-listed constants.
- Rollback: revert the branch.

### Phase 2 — GitHub repo rename (order matters or deploys break)

1. First update Terraform/IAM trust policy of `assessiq-staging-github-deploy` to trust BOTH `devxjitin/assessiq` and `devxjitin/parakh` (and the new immutable subject once known). Apply.
2. Rename repo in GitHub Settings → `parakh`. GitHub keeps redirects for clone/push, but OIDC subject uses the new name immediately.
3. `git remote set-url origin https://github.com/devxjitin/parakh.git`; update `staging.tfvars` `github_repository` and `github_immutable_subject`; update README/docs links.
4. Run a manual "Deploy staging" to prove OIDC login works. Only then remove the old name from the trust policy.

- Rollback: rename repo back (redirects/trust policy still allow both until step 4).
- Note: an existing repo with an "immutable OIDC subject" embeds name + id; verify the exact new subject string in the first failed/succeeded run before removing the old one.

### Phase 3 — AWS names (choose scope; recommended: Option B)

- **Option A, keep all AWS internals as `assessiq-*`** (zero risk; nobody sees them; this is what DOMAIN_MOVE.md decided). Only change EC2 `Name` tags, descriptions and alarm descriptions.
- **Option B (recommended): Terraform stays pinned to `assessiq` for staging, and production is created fresh with `parakh`.** Production is not applied yet, so it gets clean `parakh-prod-*` names at no migration cost. Concretely: set the Terraform `project` variable explicitly in `staging.tfvars` (`project = "assessiq"`) and change the default in `variables.tf` to `parakh`. Changing the default alone would make Terraform destroy and recreate all staging resources, so the explicit pin must land first.
- **Option C, rename staging too** (only if you want it): new ECR repos, copy SSM params to `/parakh/staging/`, new log group, new alarms/roles, copy S3 buckets, RDS identifier rename in a maintenance window (~5-10 min downtime). Do it as separate small steps, one resource family at a time, deploy script and compose file updated in the same PR as each move. Keep old resources for 7 days, then delete.
- Rollback: old resources remain until explicitly deleted.

### Phase 4 — URLs and email (mostly done)

- Done: staging web/API hosts, SES identity, Razorpay TEST webhook.
- Remaining: custom MAIL FROM `mail.parakh.nandivex.in` + `_dmarc` record; confirm old `assessiq.nandivex.in` DNS records removed in GoDaddy; production hosts + Razorpay LIVE webhook at production go-live.
- Check no hard-coded `assessiq.nandivex.in` remains (grep found 4 hits; they are in docs/tfvars comments).

### Phase 5 — Cleanup and verification

- Final `grep -ri assessiq` (expected leftovers: HKDF salt, JWT issuer if kept, DB name/user, and Option A/C AWS names if not renamed).
- Smoke test on staging: login, refresh, exam publish payment (Razorpay TEST), email delivery, health endpoint, deploy workflow, CloudWatch alarms in OK state.
- Add entry to `track.md`; update `DOMAIN_MOVE.md` "Left on purpose" section.

## Suggested order and sizing

Phase 0 → Phase 1 (one PR) → Phase 2 (own PR + manual repo rename) → Phase 3 Option B (small PR) → Phase 4 leftovers → Phase 5. Phase 3 Option C, if wanted, is a separate project after production is live.

## Risks in one line each

- Repo rename before IAM trust update = broken deploys.
- Changing Terraform `project` default without pinning staging = Terraform wants to destroy staging.
- Changing HKDF salt = payout data lost; changing JWT issuer = all users logged out.
- Renaming DB name/user = migration needed; not worth it.
- `package-lock.json` must be regenerated after the npm scope rename or `npm ci` fails in CI/Docker.
