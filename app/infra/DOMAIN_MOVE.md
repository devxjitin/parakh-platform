# Moving to parakh.nandivex.in

> Record only. The staging environment was removed from the repository; ignore the staging steps below.

The product is **Parakh** and its address is **`parakh.nandivex.in`** (production web) with the API at
`api.parakh.nandivex.in`. Staging becomes `app-staging.parakh.nandivex.in` / `api-staging.parakh.nandivex.in`.
The code and Terraform values already say this.

## Status (checked 2026-11-22)

**Staging is moved.** `app-staging.parakh.nandivex.in` returns HTTP 200 and `api-staging.parakh.nandivex.in/health`
reports the database as ok. The old `assessiq.nandivex.in` staging names no longer resolve. The `parakh.nandivex.in`
SES identity is verified (DKIM success). In SSM, `SES_FROM_EMAIL` uses `parakh.nandivex.in` and `VERIFY_BASE_URL` is
`https://parakh.nandivex.in`. The Razorpay TEST webhook points at the new API host (step 5).

**Still open:**

- Step 3: there is no custom MAIL FROM and no `_dmarc.parakh.nandivex.in` record yet.
- Production: `parakh.nandivex.in` and `api.parakh.nandivex.in` do not resolve; the production Terraform is not applied.
- Step 6: confirm in GoDaddy that the old `assessiq.nandivex.in` records are removed.

The steps below stay as the record of what the move needs, and are what to repeat for production.

## Steps (staging first)

1. **Terraform apply** (`terraform apply -var-file=envs/staging.tfvars`). It creates, for `parakh.nandivex.in`:
   - a CloudFront certificate (ACM) and aliases for `app-staging.parakh...`,
   - the API certificate and hostname for `api-staging.parakh...`,
   - a new SES identity with 3 DKIM records.
2. **GoDaddy DNS** (only the account owner can do this). Add the records Terraform prints as outputs:
   - the ACM validation CNAMEs (web and API),
   - the 3 SES DKIM CNAMEs under `_domainkey.parakh.nandivex.in`,
   - `app-staging.parakh` CNAME to the CloudFront domain, `api-staging.parakh` A record to the server IP.
3. **Email**: use a custom MAIL FROM subdomain (`mail.parakh.nandivex.in`) for SPF, not a TXT record on
   `parakh.nandivex.in` itself, because production serves the website on that exact name (a CNAME cannot
   share a name with TXT or MX records). Add DMARC at `_dmarc.parakh.nandivex.in`.
4. **Settings in AWS SSM** (`/parakh/<env>/...`): `SES_FROM_EMAIL=no-reply@parakh.nandivex.in`,
   `VERIFY_BASE_URL=https://parakh.nandivex.in`, and the GitHub deploy variables `WEB_HOSTNAME` / `API_HOSTNAME`.
   Rebuild the web app with `NEXT_PUBLIC_API_URL=https://api-staging.parakh.nandivex.in`, then deploy.
5. **Razorpay**: set the webhook to `https://api-staging.parakh.nandivex.in/payments/webhook`.
6. Keep the old `assessiq.nandivex.in` records until the new ones work, then remove them.

## Left on purpose

The product, npm packages (`@parakh/*`), GitHub repo, AWS resources (`parakh-staging-...`), SSM paths
(`/parakh/<env>/`) and Terraform state bucket (`parakh-tfstate-...`) are all named Parakh (renamed 2026-11-22).
One internal constant still says "assessiq" on purpose: the HKDF salt in `apps/api/src/common/crypto.ts`
that encrypts payout details. It is not a brand string; changing it would make stored payout data unreadable.
