# Marketing website (the `website/` Next.js export) at the bare domain, production only.
# Same pattern as the web app: private S3 bucket behind CloudFront with Origin Access Control.

locals {
  site_enabled = local.site_hostname != ""
}

resource "aws_s3_bucket" "site" {
  count  = local.site_enabled ? 1 : 0
  bucket = "${local.name}-site-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "site" {
  count                   = local.site_enabled ? 1 : 0
  bucket                  = aws_s3_bucket.site[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  count  = local.site_enabled ? 1 : 0
  bucket = aws_s3_bucket.site[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "site" {
  count                             = local.site_enabled ? 1 : 0
  name                              = "${local.name}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_acm_certificate" "site" {
  count             = local.site_enabled ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = local.legacy_site_hostname != "" ? local.legacy_site_hostname : local.site_hostname
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "site_migration" {
  count                     = local.site_enabled && local.legacy_site_hostname != "" ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = local.site_hostname
  subject_alternative_names = [local.legacy_site_hostname]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudfront_response_headers_policy" "site_security" {
  count = local.site_enabled ? 1 : 0
  name  = "${local.name}-site-security"

  security_headers_config {
    content_security_policy {
      # The website only calls the API (certificate check) and links to the app.
      content_security_policy = join("; ", [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "connect-src 'self' ${join(" ", local.api_origins)}",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ])
      override = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      override                   = true
    }
  }
}

resource "aws_cloudfront_distribution" "site" {
  count               = local.site_enabled ? 1 : 0
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200" # includes India
  aliases             = compact([local.site_hostname, local.legacy_site_hostname])
  comment             = "${local.name} website"

  origin {
    domain_name              = aws_s3_bucket.site[0].bucket_regional_domain_name
    origin_id                = "site-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.site[0].id
  }

  default_cache_behavior {
    target_origin_id           = "site-s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site_security[0].id

    # Same pretty-URL rewrite as the web app (/terms -> /terms/index.html).
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.rewrite.arn
    }

    # AWS managed policy: CachingOptimized
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # A private bucket answers 403 for a missing key; show the site's 404 page.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = try(aws_acm_certificate.site_migration[0].arn, aws_acm_certificate.site[0].arn)
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "site_bucket" {
  count = local.site_enabled ? 1 : 0
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site[0].arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  count  = local.site_enabled ? 1 : 0
  bucket = aws_s3_bucket.site[0].id
  policy = data.aws_iam_policy_document.site_bucket[0].json
}
