import type { AlchemicalNetworkViz, LigandNetworkViz } from 'alchemy-viz'

type NetworkInputs = { sdf: File; pdb: File }

const visualizations = {
  ligand_network_viz: { filename: 'ligand-network-viz.json', type: 'LigandNetworkViz', label: 'Ligand network' },
  alchemical_network_viz: { filename: 'alchemical-network-viz.json', type: 'AlchemicalNetworkViz', label: 'Alchemical network' },
} as const

export type VisualizationKey = keyof typeof visualizations
export type VisualizationPayload = LigandNetworkViz | AlchemicalNetworkViz
const visualizationKeys = Object.keys(visualizations) as VisualizationKey[]
const visualizationOutputs = [...visualizationKeys, 'status_openfe_visualize'] as const

type NetworkOutputs = {
  ligand_network: string
  alchemical_network: string
  status_openfe_network_outputs: string
  status_openfe_charge_ligands?: string
  charged_sdf?: string
} & Partial<Record<(typeof visualizationOutputs)[number], string>>

type Submission = {
  run_id: string
  input_urls: Record<keyof NetworkInputs, string>
  output_urls: NetworkOutputs
  poll_after_seconds: number
}

export type NetworkRun = { id: string; outputs: NetworkOutputs; pollAfterSeconds: number }

type TaskStatus = { status: string; error?: string; omsf_base_image?: unknown }
type ReportTaskStatus = (message: string, image?: string) => void

function isHttpUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

async function upload(url: string, file: File, kind: string) {
  const response = await fetch(url, { method: 'PUT', body: file })
  if (!response.ok) throw new Error(`${kind} upload failed (HTTP ${response.status}).`)
}

export async function submitNetwork(
  endpoint: string,
  files: NetworkInputs,
  report: (message: string) => void,
): Promise<NetworkRun> {
  if (!endpoint) throw new Error('Set VITE_LAMBDA_URL to the backend Lambda Function URL.')

  report('Submitting run…')
  const runId = crypto.randomUUID()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: '2026.04',
      workflow_name: 'demo-2026-backend',
      run_id: runId,
      details: {},
    }),
  })

  if (response.status !== 202) {
    const rejection = await response.json().catch(() => null)
    throw new Error(rejection?.error || `Submission failed (HTTP ${response.status}).`)
  }

  const submission: Submission = await response.json()
  const { input_urls: inputs, output_urls: outputs, poll_after_seconds: pollAfterSeconds } = submission ?? {}
  const urls = [
    inputs?.sdf,
    inputs?.pdb,
    outputs?.status_openfe_network_outputs,
    outputs?.ligand_network,
    outputs?.alchemical_network,
  ]
  const vizUrls = visualizationOutputs.map((key) => outputs?.[key])
  if (
    submission?.run_id !== runId ||
    !urls.every(isHttpUrl) ||
    (outputs.status_openfe_charge_ligands !== undefined && !isHttpUrl(outputs.status_openfe_charge_ligands)) ||
    (outputs.charged_sdf !== undefined &&
      (!isHttpUrl(outputs.charged_sdf) || !outputs.status_openfe_charge_ligands)) ||
    (vizUrls.some((url) => url !== undefined) && !vizUrls.every(isHttpUrl)) ||
    !Number.isFinite(pollAfterSeconds) || pollAfterSeconds <= 0
  ) {
    throw new Error('The backend returned an invalid submission response.')
  }

  report('Uploading the SDF and PDB…')
  const uploads = await Promise.allSettled([
    upload(inputs.sdf, files.sdf, 'SDF'),
    upload(inputs.pdb, files.pdb, 'PDB'),
  ])
  for (const result of uploads) {
    if (result.status === 'rejected') throw result.reason
  }

  return { id: runId, outputs, pollAfterSeconds }
}

export function networkRunFromLink(id: string, baseUrl: string): NetworkRun {
  if (!/^[a-z\d_-]+$/i.test(id)) throw new Error('This link has an invalid run ID.')
  if (!baseUrl) throw new Error('Set VITE_OUTPUTS_PUBLIC_BASE_URL to open saved run links.')

  const base = new URL(baseUrl)
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new Error('The public outputs base URL must use HTTP or HTTPS.')
  }
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/runs/${id}/outputs/`
  base.search = ''
  base.hash = ''
  return {
    id,
    outputs: {
      charged_sdf: new URL('charged-ligands.sdf', base).href,
      status_openfe_charge_ligands: new URL('tasks/openfe-charge-ligands/status.json', base).href,
      ligand_network: new URL('ligand_network.graphml', base).href,
      alchemical_network: new URL('alchemicalNetwork.zip', base).href,
      status_openfe_network_outputs: new URL('tasks/openfe-network-outputs/status.json', base).href,
      ligand_network_viz: new URL(visualizations.ligand_network_viz.filename, base).href,
      alchemical_network_viz: new URL(visualizations.alchemical_network_viz.filename, base).href,
      status_openfe_visualize: new URL('tasks/openfe-visualize/status.json', base).href,
    },
    pollAfterSeconds: 5,
  }
}

function isMissing(response: Response) {
  return response.status === 403 || response.status === 404
}

async function readTaskStatus(url: string, signal: AbortSignal) {
  const response = await fetch(url, { cache: 'no-store', signal })
  if (isMissing(response)) return null
  if (!response.ok) throw new Error(`Status check failed (HTTP ${response.status}).`)

  const task: TaskStatus = await response.json()
  if (typeof task?.status !== 'string' || !task.status) {
    throw new Error('The backend returned an invalid task status.')
  }
  return {
    status: task.status,
    error: task.error,
    image: typeof task.omsf_base_image === 'string' ? task.omsf_base_image.trim() || undefined : undefined,
  }
}

function waitForNextPoll(seconds: number) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

function formatTaskState(status: string) {
  if (status === 'COMPLETED') return 'Complete'
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()
}

export async function waitForChargedLigands(
  { outputs, pollAfterSeconds }: NetworkRun,
  report: ReportTaskStatus,
  { retryMissingStatus = false } = {},
) {
  const statusUrl = outputs.status_openfe_charge_ligands
  if (!statusUrl) {
    report('Status unavailable')
    return
  }

  const deadline = AbortSignal.timeout(20 * 60 * 1000)
  while (!deadline.aborted) {
    const task = await readTaskStatus(statusUrl, deadline).catch((error) => {
      // A missing S3 object on an older run can appear as a browser CORS error.
      if (!retryMissingStatus && error instanceof TypeError) return null
      throw error
    })
    if (!task && !retryMissingStatus) {
      report('Status unavailable')
      return
    }
    if (task) report(formatTaskState(task.status), task.image)
    if (task?.status === 'ERROR') throw new Error(task.error || 'OpenFE could not charge the ligands.')
    if (task?.status === 'COMPLETED') {
      if (!outputs.charged_sdf) return
      const response = await fetch(outputs.charged_sdf, {
        method: 'HEAD',
        cache: 'no-store',
        signal: deadline,
      }).catch((error) => {
        if (error instanceof TypeError) return null
        throw error
      })
      if (response?.ok) return outputs.charged_sdf
      return
    }
    await waitForNextPoll(pollAfterSeconds)
  }
  throw new Error('Stopped checking for ligand charging after 20 minutes. The run may still be active.')
}

export async function waitForNetwork(
  { outputs, pollAfterSeconds }: NetworkRun,
  report: ReportTaskStatus,
  { retryMissingStatus = false } = {},
) {
  const deadline = AbortSignal.timeout(20 * 60 * 1000)
  while (!deadline.aborted) {
    const task = await readTaskStatus(outputs.status_openfe_network_outputs, deadline)
    if (task) {
      report(formatTaskState(task.status), task.image)
      if (task.status === 'ERROR') throw new Error(task.error || 'OpenFE could not build the network.')
      if (task.status === 'COMPLETED') return
    } else if (!retryMissingStatus) {
      throw new Error('This run could not be found or its status is unavailable.')
    }
    await waitForNextPoll(pollAfterSeconds)
  }
  throw new Error('Stopped checking after 20 minutes. The run may still be active.')
}

export async function waitForVisualizations(
  { outputs, pollAfterSeconds }: NetworkRun,
  onReady: (key: VisualizationKey, payload: VisualizationPayload) => void,
) {
  const statusUrl = outputs.status_openfe_visualize
  if (!statusUrl) return []

  const pending = new Set(visualizationKeys)
  const issues: string[] = []
  const deadline = AbortSignal.timeout(20 * 60 * 1000)
  while (pending.size && !deadline.aborted) {
    const task = await readTaskStatus(statusUrl, deadline)
    // Older runs have no visualization status object.
    const canRetryMissing = task && task.status !== 'COMPLETED' && task.status !== 'ERROR'
    await Promise.all([...pending].map(async (key) => {
      const { label, type } = visualizations[key]
      try {
        const response = await fetch(outputs[key]!, { cache: 'no-store', signal: deadline }).catch((error) => {
          // The browser can report a missing S3 object as a CORS failure.
          if (canRetryMissing && error instanceof TypeError) return null
          throw error
        })
        if (!response || (isMissing(response) && canRetryMissing)) return
        if (!response.ok) {
          if (!isMissing(response) || task?.status !== 'ERROR') {
            issues.push(`${label} visualization is unavailable (HTTP ${response.status}).`)
          }
        } else {
          const payload: VisualizationPayload = await response.json()
          if (payload?.type !== type) throw new Error('Unexpected payload type.')
          onReady(key, payload)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load the JSON.'
        issues.push(`${label} visualization could not load. ${message}`)
      }
      pending.delete(key)
    }))

    if (task?.status === 'ERROR') issues.push(task.error || 'OpenFE could not create the visualizations.')
    if (pending.size) await waitForNextPoll(pollAfterSeconds)
  }

  if (deadline.aborted) return ['Stopped checking for visualizations after 20 minutes.']
  return issues
}
