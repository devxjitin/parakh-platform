# Amazon SES sending identity for the root domain (OTP and certificate emails).
# After apply, add the DKIM CNAME records (see outputs) in GoDaddy DNS, then request
# production access in the SES console (new accounts start in the sandbox).

resource "aws_sesv2_email_identity" "domain" {
  count          = var.domain_name != "" ? 1 : 0
  email_identity = var.domain_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# Bounce/complaint tracking (consumed by the API in Sprint 9).
resource "aws_sns_topic" "ses_events" {
  name = "${local.name}-ses-events"
}

resource "aws_sesv2_configuration_set" "main" {
  configuration_set_name = "${local.name}-default"

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }
}

resource "aws_sesv2_configuration_set_event_destination" "sns" {
  configuration_set_name = aws_sesv2_configuration_set.main.configuration_set_name
  event_destination_name = "bounces-complaints"

  event_destination {
    enabled              = true
    matching_event_types = ["BOUNCE", "COMPLAINT"]
    sns_destination {
      topic_arn = aws_sns_topic.ses_events.arn
    }
  }
}

# Sends bounce and complaint notices to the API (Sprint 9). The API confirms the subscription itself.
resource "aws_sns_topic_subscription" "ses_events_api" {
  count     = var.ses_events_endpoint == "" ? 0 : 1
  topic_arn = aws_sns_topic.ses_events.arn
  protocol  = "https"
  endpoint  = var.ses_events_endpoint
}
