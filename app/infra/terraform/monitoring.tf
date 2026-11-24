data "aws_instance" "monitored_app" {
  count = local.is_prod ? 0 : 1

  filter {
    name   = "tag:Name"
    values = ["${local.name}-app"]
  }

  filter {
    name   = "instance-state-name"
    values = ["running", "stopped"]
  }
}

locals {
  staging_infra_alarms = local.is_prod ? {} : {
    "ec2-status" = {
      namespace   = "AWS/EC2"
      metric      = "StatusCheckFailed"
      dimensions  = { InstanceId = data.aws_instance.monitored_app[0].id }
      statistic   = "Maximum"
      threshold   = 1
      comparison  = "GreaterThanOrEqualToThreshold"
      period      = 60
      evaluations = 2
    }
    "ec2-cpu" = {
      namespace   = "AWS/EC2"
      metric      = "CPUUtilization"
      dimensions  = { InstanceId = data.aws_instance.monitored_app[0].id }
      statistic   = "Average"
      threshold   = 80
      comparison  = "GreaterThanOrEqualToThreshold"
      period      = 300
      evaluations = 2
    }
    "rds-cpu" = {
      namespace   = "AWS/RDS"
      metric      = "CPUUtilization"
      dimensions  = { DBInstanceIdentifier = "${local.name}-postgres" }
      statistic   = "Average"
      threshold   = 80
      comparison  = "GreaterThanOrEqualToThreshold"
      period      = 60
      evaluations = 5
    }
    "rds-free-storage" = {
      namespace   = "AWS/RDS"
      metric      = "FreeStorageSpace"
      dimensions  = { DBInstanceIdentifier = "${local.name}-postgres" }
      statistic   = "Minimum"
      threshold   = var.db_allocated_storage_gb * 1073741824 / 5
      comparison  = "LessThanThreshold"
      period      = 60
      evaluations = 3
    }
    "rds-connections" = {
      namespace   = "AWS/RDS"
      metric      = "DatabaseConnections"
      dimensions  = { DBInstanceIdentifier = "${local.name}-postgres" }
      statistic   = "Maximum"
      threshold   = 63 # 80% of the staging PostgreSQL max_connections setting of 79.
      comparison  = "GreaterThanOrEqualToThreshold"
      period      = 60
      evaluations = 3
    }
  }

  alarm_topics = local.is_prod ? {} : {
    infra = {
      name   = "${local.name}-infra-alarms"
      region = var.region
      alarms = concat(keys(local.staging_infra_alarms), ["api-5xx"])
    }
    health = {
      name   = "${local.name}-api-health-alarms"
      region = "us-east-1"
      alarms = ["api-unhealthy"]
    }
  }
}

data "aws_iam_policy_document" "alarm_topics" {
  for_each = local.alarm_topics

  statement {
    actions   = ["sns:Publish"]
    resources = ["arn:aws:sns:${each.value.region}:${data.aws_caller_identity.current.account_id}:${each.value.name}"]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values = [
        for alarm in each.value.alarms :
        "arn:aws:cloudwatch:${each.value.region}:${data.aws_caller_identity.current.account_id}:alarm:${local.name}-${alarm}"
      ]
    }
  }
}

resource "aws_sns_topic" "infra_alarms" {
  count  = local.is_prod ? 0 : 1
  name   = local.alarm_topics.infra.name
  policy = data.aws_iam_policy_document.alarm_topics["infra"].json
}

resource "aws_cloudwatch_metric_alarm" "infra" {
  for_each = local.staging_infra_alarms

  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = "Monitor ${each.value.metric} for the staging ${each.value.namespace} resource."
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = each.value.statistic
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  period              = each.value.period
  evaluation_periods  = each.value.evaluations
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.infra_alarms[0].arn]
}

resource "aws_cloudwatch_log_group" "api" {
  count             = local.is_prod ? 0 : 1
  name              = "/${var.project}/${var.environment}/api"
  retention_in_days = 14
}

data "aws_iam_policy_document" "api_logs" {
  count = length(aws_cloudwatch_log_group.api)

  statement {
    actions = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [
      "${trimsuffix(aws_cloudwatch_log_group.api[0].arn, ":*")}:log-stream:*"
    ]
  }
}

resource "aws_iam_role_policy" "api_logs" {
  count  = length(aws_cloudwatch_log_group.api)
  name   = "${local.name}-api-logs"
  role   = aws_iam_role.app.name
  policy = data.aws_iam_policy_document.api_logs[0].json
}

resource "aws_cloudwatch_log_metric_filter" "api_5xx" {
  count          = length(aws_cloudwatch_log_group.api)
  name           = "${local.name}-api-5xx"
  log_group_name = aws_cloudwatch_log_group.api[0].name
  pattern        = "{ ($.msg = \"request\") && ($.status >= 500) && ($.status < 600) }"

  metric_transformation {
    name          = "ServerErrors"
    namespace     = "Parakh/${var.environment}/API"
    value         = "1"
    default_value = 0
    unit          = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  count = length(aws_cloudwatch_log_metric_filter.api_5xx)

  alarm_name          = "${local.name}-api-5xx"
  alarm_description   = "The staging API returned at least five HTTP 5xx responses in one minute."
  namespace           = aws_cloudwatch_log_metric_filter.api_5xx[0].metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.api_5xx[0].metric_transformation[0].name
  unit                = "Count"
  statistic           = "Sum"
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  period              = 60
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.infra_alarms[0].arn]
}

resource "aws_route53_health_check" "api" {
  count = !local.is_prod && local.api_hostname != "" ? 1 : 0

  fqdn              = local.api_hostname
  port              = 443
  type              = "HTTPS_STR_MATCH"
  resource_path     = "/health"
  search_string     = "\"database\":\"ok\""
  enable_sni        = true
  request_interval  = 30
  failure_threshold = 3
  tags              = { Name = "${local.name}-api-health" }
}

resource "aws_sns_topic" "api_health_alarms" {
  count    = length(aws_route53_health_check.api)
  provider = aws.us_east_1
  name     = local.alarm_topics.health.name
  policy   = data.aws_iam_policy_document.alarm_topics["health"].json
}

# Route 53 publishes public health check metrics to us-east-1.
resource "aws_cloudwatch_metric_alarm" "api_health" {
  count    = length(aws_route53_health_check.api)
  provider = aws.us_east_1

  alarm_name          = "${local.name}-api-unhealthy"
  alarm_description   = "The public staging API health endpoint is unhealthy."
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.api[0].id }
  statistic           = "Minimum"
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  period              = 60
  evaluation_periods  = 2
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.api_health_alarms[0].arn]
}
