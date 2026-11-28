environment = "production"

domain_name        = "nandirank.nandivex.com"
legacy_domain_name = "parakh.nandivex.com" # Keep existing exam links and certificate QR codes working.

ec2_instance_type           = "m6g.medium" # no t4g capacity in Mumbai on 2026-11-24; t4g.small/medium later
app_subnet_index            = 0
app_capacity_reservation_id = "" # cr-0a4484c4fc142d372 was used for the first launch, then cancelled
db_instance_class           = "db.t4g.micro"
enable_deletion_protection  = true

# The account budget already exists in this AWS account.
create_account_budget = false

github_repository           = "devxjitin/parakh-platform"
github_immutable_subject    = "devxjitin@292993567/parakh-platform@1469649163" # in case the immutable OIDC subject is on
create_github_oidc_provider = false                                            # already exists in this AWS account
