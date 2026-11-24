environment = "production"

domain_name = "parakh.nandivex.in" # Parakh subdomain of the company domain nandivex.in

ec2_instance_type          = "t4g.medium"
db_instance_class          = "db.t4g.micro"
enable_deletion_protection = true

# The account budget is created by the staging environment.
create_account_budget = false

github_repository           = ""
create_github_oidc_provider = false # created by staging
