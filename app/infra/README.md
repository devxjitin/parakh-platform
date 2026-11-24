# Infrastructure

| Path                 | Purpose                                                              | Status                                                       |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `docker-compose.yml` | Local Postgres                                                       | Ready                                                        |
| `terraform/`         | AWS Stage A: VPC, EC2, RDS, S3, CloudFront, SES, budget (ap-south-1) | Written and `terraform validate` passes; **not yet applied** |

## What Terraform creates (per environment)

- **Network:** VPC, 2 public + 2 private subnets, internet gateway, no NAT (saves ~$32/month). Security groups: the app host allows only 80/443; the database allows 5432 only from the app host.
- **Compute:** one EC2 (`t4g.medium` production, `t4g.small` staging) with Docker + Compose, an Elastic IP, IMDSv2, an encrypted disk, and an IAM role. **No SSH**: connect with SSM Session Manager.
- **Database:** RDS Postgres 16 (`db.t4g.micro`, encrypted, private, 7-day backups). The master password lives in Secrets Manager, not in code.
- **Storage:** a private versioned `files` bucket (logos, certificate PDFs) and a private `web` bucket behind CloudFront (HTTPS, Origin Access Control).
- **Email:** SES domain identity with DKIM, a configuration set, and an SNS topic for bounces and complaints.
- **Budget:** monthly $100 limit with alerts at $20 / $50 / $80 (created by staging only).

Stage B covers WAF and Multi-AZ. DNS stays at GoDaddy.

## One-time setup (you, in the AWS console)

- [ ] Enable MFA on the root account; stop using root. Create an admin IAM user/role and run `aws configure` (or SSO).
- [ ] Choose region `ap-south-1` (Mumbai).
- [ ] Create the Terraform state bucket and lock table (replace `<account-id>`):

```bash
aws s3api create-bucket --bucket parakh-tfstate-<account-id> --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1
aws s3api put-bucket-versioning --bucket parakh-tfstate-<account-id> \
  --versioning-configuration Status=Enabled
aws dynamodb create-table --table-name parakh-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST --region ap-south-1
```

- [ ] Decide the GoDaddy domain and put it in `envs/*.tfvars` (`domain_name`). Put your email in `envs/staging.tfvars` (`budget_email`).
- [ ] Razorpay: complete business KYC; get TEST keys; create a webhook secret.

## Deploy staging

```bash
cd infra/terraform
cp backend.hcl.example backend.hcl        # fill in bucket name; keep key = staging/...
terraform init -backend-config=backend.hcl
terraform plan  -var-file=envs/staging.tfvars
terraform apply -var-file=envs/staging.tfvars
```

For production, use a different `key` in `backend.hcl` (or `-reconfigure`) and `envs/production.tfvars`.

## After apply

1. Read the outputs: `terraform output`.
2. **GoDaddy DNS:** add the CNAMEs from `web_certificate_validation_records` and `ses_dkim_records`, plus an A record `api[-staging].<domain>` pointing to `app_public_ip`. After the certificate validates, add a CNAME `app[-staging].<domain>` pointing to `cloudfront_domain` (a second `terraform apply` may be needed once the certificate is issued).
3. **SES:** request **production access** in the console (new accounts are in the sandbox).
4. Put app config in SSM Parameter Store under `/parakh/<environment>/...` (the EC2 role can read it). The DB secret ARN is in the outputs.
5. Connect to the host: `aws ssm start-session --target <app_instance_id>`.

## Cost notes (estimates; confirm in the AWS Pricing Calculator)

Production Stage A is roughly $40-60/month (EC2 ~$25, RDS ~$15, the rest a few dollars). Staging adds ~$25-30; stop its EC2 and RDS when not in use. Turn on the budget alerts first.

## Things to know

- The web bucket serves a **static export** of the Next.js app. If you later need server-side rendering, run Next on the EC2 host behind Caddy instead and drop the CloudFront/S3 web hosting.
- `aws_instance.app` ignores `user_data` and AMI changes so a Terraform run never replaces a live server. Roll out app updates via CI/CD, not Terraform.
- Never commit `backend.hcl`, `*.tfstate`, or secrets. `.terraform.lock.hcl` should be committed.

## Deploying (GitHub Actions)

`ci.yml` runs on every push/PR (format, build, typecheck, tests, Docker image builds).
`deploy-staging.yml` runs after CI passes on `main` (or manually) and:

1. builds the static web app and syncs it to the web S3 bucket, then invalidates CloudFront;
2. builds the ARM64 `api` image and pushes it to ECR;
3. uploads `infra/deploy/*` to S3 and tells the EC2 host (through SSM, no SSH) to pull and restart via `deploy.sh`;
4. smoke-tests `https://api-staging.parakh.nandivex.in/health`.

AWS access uses GitHub OIDC (no stored AWS keys).

### One-time setup

1. Create the GitHub repository and push this folder (`git remote add origin ...`).
2. Put `github_repository = "OWNER/NAME"` in `infra/terraform/envs/staging.tfvars`, then `terraform apply -var-file=envs/staging.tfvars` (creates the OIDC provider and deploy role).
3. In GitHub: Settings -> Environments -> New environment `staging`, then add these **variables** (values from `terraform output`):

| Variable                     | Value                                             |
| ---------------------------- | ------------------------------------------------- |
| `AWS_ROLE_ARN`               | `github_deploy_role_arn`                          |
| `WEB_BUCKET`                 | `web_bucket`                                      |
| `FILES_BUCKET`               | `files_bucket`                                    |
| `CLOUDFRONT_DISTRIBUTION_ID` | `cloudfront_distribution_id`                      |
| `INSTANCE_ID`                | `app_instance_id`                                 |
| `API_HOSTNAME`               | `api_hostname` (`api-staging.parakh.nandivex.in`) |
| `WEB_HOSTNAME`               | `web_hostname` (`app-staging.parakh.nandivex.in`) |

4. Secrets for the API (JWT keys, Razorpay, DB URL, ...) go in AWS SSM Parameter Store as `/parakh/staging/NAME`. `deploy.sh` writes them into the server's `.env`.
