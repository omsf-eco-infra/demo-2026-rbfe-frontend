variable "cloudflare_account_id" {
  description = "Cloudflare account ID for the Pages project and eco-infra.rodeo zone."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[0-9a-fA-F]{32}$", var.cloudflare_account_id))
    error_message = "Enter the 32-character Cloudflare account ID."
  }
}

variable "lambda_url" {
  description = "Public Lambda Function URL from the backend's function_url output."
  type        = string
  nullable    = false

  validation {
    condition     = startswith(var.lambda_url, "https://")
    error_message = "Enter an HTTPS Lambda Function URL."
  }
}

variable "outputs_public_base_url" {
  description = "Public results URL from the backend's outputs_public_base_url output."
  type        = string
  nullable    = false

  validation {
    condition     = startswith(var.outputs_public_base_url, "https://")
    error_message = "Enter an HTTPS results URL."
  }
}
