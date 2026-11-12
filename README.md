# Demo 2026 RBFE frontend

The GitHub Actions workflows come from the [OMSF static-site-tools Python installer](https://github.com/omsf/static-site-tools/blob/bddfe9537ca08333360801f82a95bb4adaff314e/install.py) in `generic` mode. They build Vite with Bun and deploy the contents of `dist/` to Cloudflare Pages. Pushes to `main` deploy production, and pull requests targeting `main` get preview deployments.

## Provision hosting

Create `omsf-eco-infra/demo-2026-rbfe-frontend` on GitHub. Provide a `GITHUB_TOKEN` with repository access and permission to manage Actions secrets and variables, plus a `CLOUDFLARE_API_TOKEN` that can manage Pages, account API tokens, and DNS for `eco-infra.rodeo`. Use the Cloudflare account that owns the DNS zone.

From the frontend repository root, set the Cloudflare account ID and read the two public URLs from the deployed backend.

```sh
export TF_VAR_cloudflare_account_id='<Cloudflare account ID>'
export TF_VAR_lambda_url="$(tofu -chdir=../demo-2026-backend output -raw function_url)"
export TF_VAR_outputs_public_base_url="$(tofu -chdir=../demo-2026-backend output -raw outputs_public_base_url)"

tofu -chdir=terraform init
tofu -chdir=terraform plan
tofu -chdir=terraform apply
```

OpenTofu stores the deployment token in local state under `terraform/`. Keep that state private and retain it for future changes.

Push `main` after provisioning. If `main` is already on GitHub, run **Package generic static site from push** on `main` from the Actions tab. The production workflow publishes to `https://rbfe.eco-infra.rodeo`.

## OpenFE workflow

The frontend submits one run and uploads the ligand SDF and protein PDB using the returned PUT URLs. It polls `output_urls.status_openfe_charge_ligands` before polling `output_urls.status_openfe_network_outputs`.

To expose the charged ligand download, the backend can return `output_urls.charged_sdf` and publish the SDF at `runs/<run_id>/outputs/charged-ligands.sdf` before marking charging complete. Saved run links check that path under `VITE_OUTPUTS_PUBLIC_BASE_URL`. The public outputs host must support browser HEAD requests for the file.
