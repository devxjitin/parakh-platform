# Single EC2 host running Docker Compose: api and caddy (TLS).

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${local.name}-app"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "FilesBucket"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.files.arn}/*"]
  }

  statement {
    sid       = "FilesBucketList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.files.arn]
  }

  statement {
    sid       = "SendEmail"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["*"]
  }

  statement {
    sid     = "ReadAppConfig"
    actions = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = [
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project}/${var.environment}/*"
    ]
  }

  statement {
    sid       = "ReadDbSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.main.master_user_secret[0].secret_arn]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "${local.name}-app"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_iam_instance_profile" "app" {
  name = "${local.name}-app"
  role = aws_iam_role.app.name
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.al2023_arm64.value
  instance_type          = var.ec2_instance_type
  subnet_id              = aws_subnet.public[var.app_subnet_index].id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name

  # Launch into a held capacity reservation when AWS is short on this instance type.
  dynamic "capacity_reservation_specification" {
    for_each = var.app_capacity_reservation_id != "" ? [1] : []
    content {
      capacity_reservation_target {
        capacity_reservation_id = var.app_capacity_reservation_id
      }
    }
  }

  metadata_options {
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 2          # containers need 2 hops
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.ec2_root_volume_gb
    encrypted   = true
  }

  user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail
    dnf install -y docker git
    systemctl enable --now docker
    usermod -aG docker ec2-user
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -SL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-aarch64" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    mkdir -p /opt/parakh
    chown ec2-user:ec2-user /opt/parakh
  EOT

  # Changing user_data should not destroy a running host; bootstrap is one-time.
  lifecycle {
    ignore_changes = [ami, user_data, capacity_reservation_specification]
  }

  tags = { Name = "${local.name}-app" }
}

# Stable public IP for DNS (api.<domain> A record at GoDaddy).
resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id
  tags     = { Name = "${local.name}-app-eip" }
}
