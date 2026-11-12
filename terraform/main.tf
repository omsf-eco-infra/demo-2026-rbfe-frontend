terraform {
  required_version = ">= 1.3"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.9.0" # static-site-tools issue #28 tracks the token policy schema change.
    }
    github = {
      source  = "integrations/github"
      version = "~> 5.0"
    }
  }
}

locals {
  github_owner     = "omsf-eco-infra"
  github_repo_name = "demo-2026-rbfe-frontend"
  project_name     = local.github_repo_name
  zone_name        = "eco-infra.rodeo"
  site_hostname    = "rbfe.${local.zone_name}"
}

provider "github" {
  owner = local.github_owner
}

module "cloudflare_pages" {
  source = "git::https://github.com/omsf/static-site-tools.git//modules/cloudflare_pages?ref=bddfe9537ca08333360801f82a95bb4adaff314e"

  cloudflare_account_id   = var.cloudflare_account_id
  cloudflare_project_name = local.project_name
  cloudflare_token_name   = "${local.project_name}-github-actions"
}

module "github_vars" {
  source = "git::https://github.com/omsf/static-site-tools.git//modules/github_vars?ref=bddfe9537ca08333360801f82a95bb4adaff314e"

  github_repository       = "${local.github_owner}/${local.github_repo_name}"
  cloudflare_account_id   = var.cloudflare_account_id
  cloudflare_project_name = local.project_name
  cloudflare_token        = module.cloudflare_pages.cloudflare_token
}

data "cloudflare_zones" "site" {
  account = { id = var.cloudflare_account_id }
  name    = local.zone_name
  match   = "all"

  lifecycle {
    postcondition {
      condition     = length(self.result) == 1
      error_message = "Expected exactly one Cloudflare zone named ${local.zone_name} in the configured account."
    }
  }
}

resource "cloudflare_pages_domain" "site" {
  account_id   = var.cloudflare_account_id
  project_name = local.project_name
  name         = local.site_hostname

  depends_on = [module.cloudflare_pages]
}

resource "cloudflare_dns_record" "site" {
  zone_id = one(data.cloudflare_zones.site.result).id
  name    = cloudflare_pages_domain.site.name
  type    = "CNAME"
  content = module.cloudflare_pages.cloudflare_subdomain
  proxied = true
  ttl     = 1
}

resource "github_actions_variable" "vite" {
  for_each = {
    VITE_LAMBDA_URL              = var.lambda_url
    VITE_OUTPUTS_PUBLIC_BASE_URL = var.outputs_public_base_url
  }

  repository    = local.github_repo_name
  variable_name = each.key
  value         = each.value
}

output "site_url" {
  value = "https://${cloudflare_pages_domain.site.name}"
}
