import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { Key } from '@shared/i18n'
import { PROVIDERS, providerInfo, type ProviderId, type SettingsState } from '@shared/types'
import { ProviderIcon } from '../shared/Icon'
import { useT } from '../shared/hooks'
import { AccountPane } from './AccountPane'
import { PANES, PaneView, type PaneId } from './panes'
import { Setup } from './Setup'

type Selection = { kind: 'pane'; id: PaneId } | { kind: 'account'; id: ProviderId }

const PANE_ICON: Record<PaneId, string> = {
  appearance: '◐', rings: '◎', position: '⇱', general: '⚙', notifications: '🔔', network: '⇅', about: 'ⓘ'
}

export function Settings() {
  const [s, setS] = useState<SettingsState | null>(null)
  const [selection, setSelection] = useState<Selection>({ kind: 'pane', id: 'appearance' })
  const [search, setSearch] = useState('')

  useEffect(() => {
    void window.pulse.getSettingsState().then(setS)
    return window.pulse.onSettingsState(setS)
  }, [])

  const t = useT(s?.locale ?? 'en')
  const catalogue = useMemo(() => PROVIDERS, [])
  if (!s) return null

  document.title = t('set.title')
  const patch = window.pulse.patchSettings

  if (!s.settings.setupDone) {
    return (
      <Setup
        s={s}
        t={t}
        onDone={(ids) => {
          window.pulse.completeSetup(ids)
          // Copilot has nothing to read until signed in: land on its pane.
          if (ids.includes('copilot') && !s.hasKey.copilot) setSelection({ kind: 'account', id: 'copilot' })
          else setSelection({ kind: 'pane', id: 'appearance' })
        }}
      />
    )
  }

  const q = search.trim().toLowerCase()
  const matches = (...texts: string[]): boolean => q === '' || texts.some((x) => x.toLowerCase().includes(q))

  const paneItems = (section: 'panel' | 'app' | 'last') =>
    PANES.filter((p) => p.section === section && matches(t(p.title), ...p.rows.map((r: Key) => t(r)))).map((p) => (
      <SidebarItem key={p.id} active={selection.kind === 'pane' && selection.id === p.id} onClick={() => setSelection({ kind: 'pane', id: p.id })}
        icon={<span className="glyph">{PANE_ICON[p.id]}</span>} label={t(p.title)} />
    ))

  const accountItem = (id: ProviderId) => {
    const info = providerInfo(id)
    if (!matches(info.name)) return null
    return (
      <SidebarItem key={id} active={selection.kind === 'account' && selection.id === id} onClick={() => setSelection({ kind: 'account', id })}
        icon={<ProviderIcon name={info.icon} size={16} />} label={info.name} />
    )
  }

  const enabledIds = s.settings.enabled.filter((id) => catalogue.some((p) => p.id === id))
  const subs = catalogue.filter((p) => !enabledIds.includes(p.id) && p.billing === 'subscription')
  const apis = catalogue.filter((p) => !enabledIds.includes(p.id) && p.billing === 'api')

  const section = (title: string | null, items: Array<ReactElement | null>) => {
    const shown = items.filter(Boolean)
    if (shown.length === 0) return null
    return (
      <div className="side-section">
        {title && <div className="side-heading">{title}</div>}
        {shown}
      </div>
    )
  }

  const nothing = [paneItems('panel'), paneItems('app'), paneItems('last'), ...enabledIds.map(accountItem), ...subs.map((p) => accountItem(p.id)), ...apis.map((p) => accountItem(p.id))].flat().filter(Boolean).length === 0

  const title =
    selection.kind === 'pane'
      ? t(PANES.find((p) => p.id === selection.id)!.title)
      : providerInfo(selection.id).name

  return (
    <div className="shell">
      <aside className="sidebar">
        <input className="search" placeholder={t('set.search')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('set.search')} />
        <nav>
          {section(t('set.section.panel'), paneItems('panel'))}
          {section(t('set.section.app'), paneItems('app'))}
          {section(t('set.section.enabled'), enabledIds.map(accountItem))}
          {section(t('set.section.subscriptions'), subs.map((p) => accountItem(p.id)))}
          {section(t('set.section.api'), apis.map((p) => accountItem(p.id)))}
          {section(null, paneItems('last'))}
          {nothing && <div className="side-empty">{t('set.noMatches')}</div>}
        </nav>
      </aside>
      <main className="content">
        {selection.kind === 'pane' && <h1 className="content-title">{title}</h1>}
        {selection.kind === 'pane' ? <PaneView id={selection.id} s={s} t={t} patch={patch} /> : <AccountPane key={selection.id} s={s} t={t} id={selection.id} patch={patch} />}
      </main>
    </div>
  )
}

function SidebarItem({ active, onClick, icon, label }: { active: boolean; onClick(): void; icon: ReactElement; label: string }) {
  return (
    <button type="button" className={`side-item${active ? ' active' : ''}`} onClick={onClick}>
      <span className="side-icon">{icon}</span>
      <span className="side-label">{label}</span>
    </button>
  )
}
