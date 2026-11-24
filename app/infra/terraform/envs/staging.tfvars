environment = "staging"

# Set once the GoDaddy domain is decided (e.g. "yourdomain.com"). Empty = skip cert + SES identity.
# Staging already runs on this domain (see ../DOMAIN_MOVE.md for the move steps; repeat them for production).
domain_name = "parakh.nandivex.in" # Parakh subdomain of the company domain nandivex.in

# Staging is smaller and can be stopped at night to save credit.
ec2_instance_type          = "t4g.small"
db_instance_class          = "db.t4g.micro"
enable_deletion_protection = false

create_account_budget = false # skipped for now; set true + budget_email to enable alerts
budget_email          = ""    # <- your email for $20 / $50 / $80 alerts

# GitHub repo ("owner/name") allowed to deploy via OIDC. Fill in once the repository exists.
github_repository           = "devxjitin/parakh"
github_immutable_subject    = "devxjitin@292993567/parakh@1460239934" # repo has immutable OIDC subject on
create_github_oidc_provider = false # already exists in this AWS account (shared with other projects)
