import 'alchemy-viz'
import type { VisualizationKey, VisualizationPayload } from './network'

export const visualizations = document.querySelector<HTMLElement>('#visualizations')!
export const visualizationStatus = document.querySelector<HTMLParagraphElement>('#visualization-status')!

const tabs = Array.from(visualizations.querySelectorAll<HTMLButtonElement>('[role="tab"]'), (button) => ({
  button,
  key: button.dataset.visualization as VisualizationKey,
  panel: document.getElementById(button.getAttribute('aria-controls')!)!,
  payload: null as VisualizationPayload | null,
}))

function selectTab(selected: (typeof tabs)[number]) {
  if (!selected.payload) return
  for (const tab of tabs) {
    const active = tab === selected
    tab.button.setAttribute('aria-selected', String(active))
    tab.button.tabIndex = active ? 0 : -1
    tab.panel.hidden = !active
  }

  // Mount the viewer only after its panel has a visible layout.
  if (!selected.panel.firstElementChild) {
    const view = document.createElement('alchemy-view') as HTMLElement & { payload: VisualizationPayload }
    view.payload = selected.payload
    selected.panel.append(view)
  }
}

for (const tab of tabs) {
  tab.button.addEventListener('click', () => selectTab(tab))
  tab.button.addEventListener('keydown', (event) => {
    const available = tabs.filter(({ button }) => !button.disabled)
    const index = available.indexOf(tab)
    const last = available.length - 1
    let next: number
    switch (event.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1
        break
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      default:
        return
    }
    event.preventDefault()
    selectTab(available[next])
    available[next].button.focus()
  })
}

export function showVisualization(key: VisualizationKey, payload: VisualizationPayload) {
  const tab = tabs.find((tab) => tab.key === key)!
  tab.payload = payload
  tab.button.disabled = false
  if (tabs.every(({ panel }) => panel.hidden)) selectTab(tab)
}

export function resetVisualizations() {
  visualizations.hidden = true
  visualizationStatus.textContent = ''
  for (const tab of tabs) {
    tab.payload = null
    tab.button.disabled = true
    tab.button.tabIndex = -1
    tab.button.setAttribute('aria-selected', 'false')
    tab.panel.hidden = true
    tab.panel.replaceChildren()
  }
}
