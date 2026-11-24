output "app_public_ip" {
  description = "Create an A record api.<domain> -> this IP at GoDaddy."
  value       = aws_eip.app.public_ip
}

output "app_instance_id" {
  description = "Connect with: aws ssm start-session --target <id>"
  value       = aws_instance.app.id
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}

output "db_secret_arn" {
  description = "Secrets Manager secret holding the DB master credentials."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "files_bucket" {
  value = aws_s3_bucket.files.bucket
}

output "web_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.web.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "web_certificate_validation_records" {
  description = "Add these CNAMEs at GoDaddy so ACM can issue the web certificate."
  value = var.domain_name != "" ? [
    for o in aws_acm_certificate.web[0].domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ] : []
}

output "ses_dkim_records" {
  description = "Add these CNAMEs at GoDaddy to verify the SES domain (name -> <token>.dkim.amazonses.com)."
  value = var.domain_name != "" ? [
    for t in aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens : {
      name  = "${t}._domainkey.${var.domain_name}"
      type  = "CNAME"
      value = "${t}.dkim.amazonses.com"
    }
  ] : []
}

output "ses_configuration_set" {
  value = aws_sesv2_configuration_set.main.configuration_set_name
}

output "ses_events_topic_arn" {
  value = aws_sns_topic.ses_events.arn
}

output "ecr_registry" {
  value = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com"
}

output "github_deploy_role_arn" {
  description = "Set as the AWS_ROLE_ARN variable of the GitHub Environment."
  value       = local.github_enabled ? aws_iam_role.github_deploy[0].arn : ""
}

output "web_hostname" {
  value = local.web_hostname
}

output "api_hostname" {
  value = local.api_hostname
}
