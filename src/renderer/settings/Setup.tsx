import { useState } from 'react'
import type { T } from '@shared/i18n'
import { PROVIDERS, type ProviderId, type SettingsState } from '@shared/types'
import { ProviderIcon } from '../shared/Icon'
import { Button, Pill } from './ui'

/**
 * First-run chooser. Every service starts unchecked: nothing is read, and no
 * credential is touched, until "Done". Closing the window leaves monitoring off.
 */
export function Setup({ s, t, onDone }: { s: SettingsState; t: T; onDone(ids: ProviderId[]): void }) {
  const [picked, setPicked] = useState<ProviderId[]>([])
  const toggle = (id: ProviderId): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const detected = PROVIDERS.filter((p) => s.detected[p.id])

  const section = (title: string, billing: 'subscription' | 'api') => {
    const list = PROVIDERS.filter((p) => p.billing === billing).sort((a, b) => Number(!!s.detected[b.id]) - Number(!!s.detected[a.id]) || 0)
    if (list.length === 0) return null
    return (
      <div className="setup-section">
        <h3 className="group-title">{title}</h3>
        <div className="group-card">
          {list.map((p) => (
            <label key={p.id} className="setup-row">
              <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
              <ProviderIcon name={p.icon} size={20} />
              <div className="setup-text">
                <div className="row-title">
                  {p.name} {s.detected[p.id] && <Pill tone="good">{t('setup.detectedBadge')}</Pill>}
                </div>
                <div className="row-sub">{t(`acct.access.${p.id}` as 'acct.access.copilot')}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="setup">
      <h1>{t('setup.title')}</h1>
      <p className="setup-lead">{t('setup.lead')}</p>
      <div className="setup-list">
        {section(t('setup.subscriptions'), 'subscription')}
        {section(t('setup.api'), 'api')}
      </div>
      <div className="setup-actions">
        <span className="setup-hint">{picked.length === 0 ? t('setup.none') : ''}</span>
        <Button onClick={() => setPicked(detected.map((p) => p.id))} disabled={detected.length === 0}>{t('setup.selectDetected')}</Button>
        <Button kind="primary" disabled={picked.length === 0} onClick={() => onDone(picked)} style={{ marginLeft: 8 }}>{t('setup.done')}</Button>
      </div>
    </div>
  )
}
