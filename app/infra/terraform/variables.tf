variable "project" {
  type    = string
  default = "parakh"
}

variable "environment" {
  description = "staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  type    = string
  default = "ap-south-1" # Mumbai
}

variable "domain_name" {
  description = "Root domain registered at GoDaddy (e.g. example.com). Leave empty to skip certificates/SES identity until the domain is decided."
  type        = string
  default     = ""
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "ec2_instance_type" {
  description = "Runs api and caddy via Docker Compose."
  type        = string
  default     = "t4g.medium"
}

variable "ec2_root_volume_gb" {
  type    = number
  default = 30
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_backup_retention_days" {
  type    = number
  default = 7
}

variable "enable_deletion_protection" {
  description = "Protect the database from accidental deletion (set true in production)."
  type        = bool
  default     = false
}

variable "create_account_budget" {
  description = "AWS Budgets are per account. Enable in ONE environment only."
  type        = bool
  default     = false
}

variable "budget_email" {
  description = "Email that receives budget alerts ($20 / $50 / $80 of a $100 monthly limit)."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  type    = number
  default = 100
}

variable "github_repository" {
  description = "GitHub repo allowed to deploy, as \"owner/name\" (e.g. NandiVex/parakh). Empty = no deploy role is created."
  type        = string
  default     = ""
}

variable "github_immutable_subject" {
  description = "Optional extra OIDC subject prefix for repos with GitHub's immutable subject on, e.g. \"owner@ID/name@ID\". Allowed in addition to github_repository."
  type        = string
  default     = ""
}

variable "create_github_oidc_provider" {
  description = "The GitHub OIDC provider is account-wide. true in ONE environment (staging), false elsewhere."
  type        = bool
  default     = true
}

variable "ses_events_endpoint" {
  description = "Full HTTPS URL of the API's mail-events endpoint including its secret key, for example https://api-staging.parakh.nandivex.in/mail/ses-events?key=SES_EVENTS_KEY. Empty = no subscription."
  type        = string
  default     = ""
  sensitive   = true
}

variable "app_subnet_index" {
  description = "Which public subnet (0 = first AZ, 1 = second AZ) the app server runs in. Change it when AWS has no capacity for the instance type in an AZ."
  type        = number
  default     = 0
}

variable "app_capacity_reservation_id" {
  description = "Optional targeted EC2 capacity reservation (cr-...) to launch the app server into. Only read at launch."
  type        = string
  default     = ""
}
