import './style.css'
import {
  networkRunFromLink, submitNetwork, waitForChargedLigands, waitForNetwork, waitForVisualizations, type NetworkRun,
} from './network'
import { resetVisualizations, showVisualization, visualizationStatus, visualizations } from './visualizations'

const form = document.querySelector<HTMLFormElement>('#network-form')!
const pickers = document.querySelector<HTMLFieldSetElement>('#file-pickers')!
const buildButton = document.querySelector<HTMLButtonElement>('#build')!
const inputs = document.querySelector<HTMLElement>('#inputs')!
const inputStatus = document.querySelector<HTMLParagraphElement>('#input-status')!
const progress = document.querySelector<HTMLElement>('#progress')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const chargingStatus = document.querySelector<HTMLParagraphElement>('#charging-status')!
const planningStatus = document.querySelector<HTMLParagraphElement>('#planning-status')!
const chargingImage = document.querySelector<HTMLDetailsElement>('#charging-image')!
const planningImage = document.querySelector<HTMLDetailsElement>('#planning-image')!
const runLinkNote = document.querySelector<HTMLParagraphElement>('#run-link-note')!
const runLink = document.querySelector<HTMLAnchorElement>('#run-link')!
const filesCard = document.querySelector<HTMLElement>('#files')!
const chargedLigands = document.querySelector<HTMLAnchorElement>('#charged-ligands')!
const ligandNetwork = document.querySelector<HTMLAnchorElement>('#ligand-network')!
const alchemicalNetwork = document.querySelector<HTMLAnchorElement>('#alchemical-network')!

const files: Partial<Record<'sdf' | 'pdb', File>> = {}
let running = false

function updateBuildButton() {
  buildButton.disabled = running || !files.sdf || !files.pdb
}

for (const kind of ['sdf', 'pdb'] as const) {
  const input = document.querySelector<HTMLInputElement>(`#${kind}`)!
  const selection = document.querySelector<HTMLSpanElement>(`#${kind}-selection`)!
  const picker = input.closest('label')!

  function selectFile(candidates: FileList) {
    if (running || candidates.length === 0) return
    const file = candidates[0]
    if (candidates.length !== 1 || !file.name.toLowerCase().endsWith(`.${kind}`)) {
      inputStatus.textContent = `Choose one .${kind} file.`
      return
    }
    if (file.size === 0) {
      inputStatus.textContent = 'Choose a file that is not empty.'
      return
    }

    files[kind] = file
    selection.textContent = file.name
    picker.dataset.selected = ''
    inputStatus.textContent = ''
    filesCard.hidden = true
    resetVisualizations()
    updateBuildButton()
  }

  input.addEventListener('change', () => {
    if (input.files) selectFile(input.files)
    input.value = ''
  })

  picker.addEventListener('dragover', (event) => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = running ? 'none' : 'copy'
    picker.classList.toggle('dragging', !running)
  })
  picker.addEventListener('dragleave', (event) => {
    if (!(event.relatedTarget instanceof Node) || !picker.contains(event.relatedTarget)) {
      picker.classList.remove('dragging')
    }
  })
  picker.addEventListener('drop', (event) => {
    event.preventDefault()
    picker.classList.remove('dragging')
    if (event.dataTransfer) selectFile(event.dataTransfer.files)
  })
}

async function showRun(
  load: () => NetworkRun | Promise<NetworkRun>,
  { retryMissingStatus = false } = {},
) {
  running = true
  pickers.disabled = true
  filesCard.hidden = true
  for (const item of filesCard.querySelectorAll('li')) item.hidden = true
  for (const details of [chargingImage, planningImage]) {
    details.hidden = true
    details.open = false
  }
  resetVisualizations()
  updateBuildButton()
  let activePhase: HTMLParagraphElement | undefined
  try {
    const run = await load()
    const url = new URL(location.href)
    url.searchParams.set('run_id', run.id)
    history.replaceState(history.state, '', url)
    runLink.href = url.href
    runLinkNote.hidden = false
    showProgress()

    activePhase = chargingStatus
    const chargedSdf = await waitForChargedLigands(run, (state, image) => {
      updatePhase(chargingStatus, chargingImage, state, image)
    }, { retryMissingStatus })
    if (chargedSdf) showDownload(chargedLigands, chargedSdf)

    activePhase = planningStatus
    await waitForNetwork(run, (state, image) => {
      updatePhase(planningStatus, planningImage, state, image)
    }, { retryMissingStatus })
    activePhase = undefined
    showDownload(ligandNetwork, run.outputs.ligand_network)
    showDownload(alchemicalNetwork, run.outputs.alchemical_network)

    if (run.outputs.status_openfe_visualize) {
      visualizations.hidden = false
      visualizationStatus.textContent = 'Waiting for network visualizations…'
      try {
        const issues = await waitForVisualizations(run, showVisualization)
        visualizationStatus.textContent = issues.join(' ')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not check visualization status.'
        visualizationStatus.textContent = `Visualization check failed. ${message}`
      }
    }
  } catch (error) {
    if (activePhase) activePhase.textContent = 'Error'
    reportStatus(error instanceof Error ? error.message : 'The network build failed.')
  } finally {
    running = false
    pickers.disabled = false
    updateBuildButton()
  }
}

function updatePhase(status: HTMLParagraphElement, details: HTMLDetailsElement, state: string, image?: string) {
  if (status.textContent !== state) status.textContent = state
  if (!image) return

  const [summary, reference] = details.querySelectorAll('code')
  if (details.hidden || reference.textContent !== image) {
    const name = image.slice(image.lastIndexOf('/') + 1)
    summary.textContent = name.replace(/(@sha256:[\da-f]{12})[\da-f]{52}$/i, '$1…')
    reference.textContent = image
    details.hidden = false
  }
}

function reportStatus(message: string) {
  const currentStatus = progress.hidden ? inputStatus : status
  currentStatus.textContent = message
}

function showDownload(link: HTMLAnchorElement, url: string) {
  link.href = url
  link.closest('li')!.hidden = false
  filesCard.hidden = false
}

function showProgress() {
  inputs.hidden = true
  progress.hidden = false
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const { sdf, pdb } = files
  if (running || !sdf || !pdb) return

  void showRun(
    () => submitNetwork(import.meta.env.VITE_LAMBDA_URL?.trim() ?? '', { sdf, pdb }, reportStatus),
    { retryMissingStatus: true },
  )
})

const linkedRunId = new URLSearchParams(location.search).get('run_id')
if (linkedRunId !== null) {
  showProgress()
  void showRun(() => networkRunFromLink(linkedRunId, import.meta.env.VITE_OUTPUTS_PUBLIC_BASE_URL?.trim() ?? ''))
}
