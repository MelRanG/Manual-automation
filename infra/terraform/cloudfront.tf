data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${local.name_prefix} HTTPS frontdoor"
  price_class     = "PriceClass_100"
  # HTTP/2 viewer connections corrupt SSE framing (ERR_HTTP2_PROTOCOL_ERROR on
  # text/event-stream responses). Pin viewer to HTTP/1.1 until streaming endpoints
  # are moved off the CloudFront path.
  http_version = "http1.1"

  origin {
    domain_name = aws_lb.app.dns_name
    origin_id   = "${local.name_prefix}-alb-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      # LLM endpoints can take >30s; raise to the CloudFront soft max (60s).
      # Beyond 60s requires a Service Quota increase.
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }
  }

  default_cache_behavior {
    target_origin_id         = "${local.name_prefix}-alb-origin"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
    # Disable compression so CloudFront does not buffer/transform chunked SSE responses.
    compress = false
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
