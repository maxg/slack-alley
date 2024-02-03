variable "bucket" {}
variable "key" {}
variable "region" {}
variable "access_key" {}
variable "secret_key" {}

variable "domain" {}

# terraform init -backend-config=terraform.tfvars
terraform {
  required_version = ">= 0.12"
  backend "s3" {}
}

locals {
  app = var.key
  name = "${local.app}${terraform.workspace == "default" ? "" : "-${terraform.workspace}"}"
}

data "external" "lambda_zip" {
  program = ["sh", "-c", <<EOF
echo '{ "name":"'$(find ../out -name 'lambda-*.zip' | sort | tail -1)'" }'
EOF
  ]
}

provider "aws" {
  access_key = var.access_key
  secret_key = var.secret_key
  region = var.region
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "emails" {
  bucket = "${local.name}-emails"
  acl = "private"
  lifecycle_rule {
    id = "${local.name}-emails-expiration-rule"
    enabled = true
    expiration {
      days = 1
    }
  }
  tags = {
    Terraform = local.name
  }
}

resource "aws_s3_bucket_public_access_block" "emails" {
  bucket = aws_s3_bucket.emails.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "data" {
  name = "${local.name}-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key = "cid"
  range_key = "key"
  attribute {
    name = "cid"
    type = "S"
  }
  attribute {
    name = "key"
    type = "S"
  }
  tags = {
    Terraform = local.name
  }
}

locals {
  on_email = "on-email"
  lambda_functions = [ local.on_email ]
}

resource "aws_lambda_function" "functions" {
  count = length(local.lambda_functions)
  function_name = "${local.name}-${element(local.lambda_functions, count.index)}"
  filename = data.external.lambda_zip.result.name
  source_code_hash = filebase64sha256(data.external.lambda_zip.result.name)
  runtime = "nodejs16.x"
  handler = "${element(local.lambda_functions, count.index)}.handler"
  role = aws_iam_role.lambda.arn
  timeout = 4
  reserved_concurrent_executions = 1
  depends_on = [aws_iam_role_policy.lambda]
  environment {
    variables = {
      DATA_TABLE = aws_dynamodb_table.data.name
    }
  }
  tags = {
    Terraform = local.name
  }
}

resource "aws_ses_domain_identity" "domain" {
  domain = var.domain
}

resource "aws_ses_active_receipt_rule_set" "main" {
  rule_set_name = aws_ses_receipt_rule_set.rules.rule_set_name
}

resource "aws_ses_receipt_rule_set" "rules" {
  rule_set_name = local.name
}

resource "aws_ses_receipt_rule" "receive" {
  name = "${local.name}-receive"
  rule_set_name = aws_ses_receipt_rule_set.rules.rule_set_name
  recipients = [aws_ses_domain_identity.domain.domain]
  enabled = true
  s3_action {
    bucket_name = aws_s3_bucket.emails.bucket
    position = 1
  }
  lambda_action {
    function_arn = element(
      aws_lambda_function.functions.*.arn,
      index(local.lambda_functions, local.on_email)
    )
    invocation_type = "Event"
    position = 2
  }
  depends_on = [aws_s3_bucket_policy.ses, aws_lambda_permission.ses]
}

resource "aws_s3_bucket_policy" "ses" {
  bucket = aws_s3_bucket.emails.id
  policy = data.aws_iam_policy_document.s3_put_ses.json
}

data "aws_iam_policy_document" "s3_put_ses" {
  statement {
    actions = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.emails.arn}/*"]
    principals {
      type = "Service"
      identifiers = ["ses.amazonaws.com"]
    }
  }
}

resource "aws_lambda_permission" "ses" {
  action = "lambda:InvokeFunction"
  function_name = "${local.name}-${local.on_email}"
  principal = "ses.amazonaws.com"
}

data "aws_iam_policy_document" "assume_role_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name = "${local.name}-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role_lambda.json
}

data "aws_iam_policy_document" "lambda" {
  statement {
    actions = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:*"]
  }
  statement {
    actions = ["dynamodb:*"]
    resources = [aws_dynamodb_table.data.arn]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name = "${local.name}-lambda-policy"
  role = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

resource "aws_cloudwatch_log_group" "logs" {
  count = length(local.lambda_functions)
  name = "/aws/lambda/${aws_lambda_function.functions[count.index].function_name}"
  retention_in_days = 1
  tags = {
    Terraform = local.name
  }
}

output "ses-domain-verification" {
  value = aws_ses_domain_identity.domain.verification_token
}
