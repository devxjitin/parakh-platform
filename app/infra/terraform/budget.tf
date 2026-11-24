# Budget alerts protect the $100 credit. Budgets are account-wide: enable in ONE environment.
locals {
  budget_alerts_usd = [20, 50, 80]
}

resource "aws_budgets_budget" "monthly" {
  count        = var.create_account_budget && var.budget_email != "" ? 1 : 0
  name         = "${var.project}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = local.budget_alerts_usd
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "ABSOLUTE_VALUE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.budget_email]
    }
  }
}
