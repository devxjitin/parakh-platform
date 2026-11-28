terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }

  # Remote state. Create the bucket + lock table first (see README), then run:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Owner       = "NandiVex Technologies"
    }
  }
}

# CloudFront certificates must live in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Owner       = "NandiVex Technologies"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name    = "${var.project}-${var.environment}"
  azs     = slice(data.aws_availability_zones.available.names, 0, 2)
  is_prod = var.environment == "production"

  # Production: the marketing website lives at <domain> (nandirank.nandivex.com), the web app at
  # app.<domain> and the API at api.<domain>. Other environments use app-<env>.<domain> and
  # api-<env>.<domain> and have no marketing website. Certificate checks are a page of the web app
  # (/verify/) and a form on the website, so they need no hostname of their own.
  web_hostname  = var.domain_name == "" ? "" : (local.is_prod ? "app.${var.domain_name}" : "app-${var.environment}.${var.domain_name}")
  site_hostname = var.domain_name != "" && local.is_prod ? var.domain_name : ""
  api_hostname  = var.domain_name != "" ? "${var.environment == "production" ? "api" : "api-${var.environment}"}.${var.domain_name}" : ""

  legacy_site_hostname = local.is_prod ? var.legacy_domain_name : ""
  legacy_web_hostname  = local.legacy_site_hostname != "" ? "app.${local.legacy_site_hostname}" : ""
  legacy_api_hostname  = local.legacy_site_hostname != "" ? "api.${local.legacy_site_hostname}" : ""
  api_origins          = [for host in compact([local.api_hostname, local.legacy_api_hostname]) : "https://${host}"]
  email_domain         = local.legacy_site_hostname != "" ? local.legacy_site_hostname : var.domain_name
}
