import { useEffect, useState } from 'react'
import { amountLines, availabilityText, formatClock, formatReset, windowTitle } from '@shared/format'
import type { T } from '@shared/i18n'
import type { CopilotStatus, DeepPartial } from '@shared/ipc'
import { headlineWindow, isSpent, percentOf, tintColor, windowTint } from '@shared/rules'
import { accountSettings } from '@shared/settings'
import { providerInfo, type AppSettings, type ProviderId, type SettingsState } from '@shared/types'
import { ProviderIcon } from '../shared/Icon'
import { Banner, Button, Group, Pill, Row, Select, SecretField, Switch } from './ui'

interface Props {
  s: SettingsState
  t: T
  id: ProviderId
  patch(p: DeepPartial<AppSettings>): void
}

export function AccountPane({ s, t, id, patch }: Props) {
  const info = providerInfo(id)
  const enabled = s.settings.enabled.includes(id)
  const acct = accountSettings(s.settings, id)
  const entry = s.entries.find((e) => e.providerId === id)
  const snapshot = entry?.snapshot
  const diag = s.diagnostics[id]
  const detected = s.detected[id]
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true

  const toggle = (on: boolean): void => {
    const next = on ? [...s.settings.enabled, id] : s.settings.enabled.filter((x) => x !== id)
    window.pulse.setEnabled(next)
  }

  const windows = snapshot?.windows ?? []
  const headline = headlineWindow(windows, acct.pinnedWindow)

  return (
    <>
      <div className="acct-head">
        <ProviderIcon name={info.icon} size={28} />
        <div>
          <h2>{info.name}</h2>
          {detected && <Pill tone="good">{t('acct.detected')}</Pill>}
        </div>
      </div>
      <p className="acct-access">{t(`acct.access.${id}` as 'acct.access.copilot')}</p>

      <Group>
        <Row title={t('acct.show')} subtitle={t('acct.show.sub')}>
          <Switch checked={enabled} onChange={toggle} label={t('acct.show')} />
        </Row>
        {enabled && (
          <>
            <Row title={t('acct.ringShows')} subtitle={t('acct.ringShows.sub')}>
              <Select
                value={acct.pinnedWindow ?? ''}
                onChange={(v) => patch({ accounts: { [id]: { ...acct, pinnedWindow: v === '' ? null : v } } })}
                label={t('acct.ringShows')}
                options={[{ value: '', label: t('acct.ringShows.auto') }, ...windows.map((w) => ({ value: w.id, label: windowTitle(w, t) }))]}
              />
            </Row>
            <Row title={t('acct.color')} subtitle={t('acct.color.sub')}>
              <Select
                value={acct.ringTint ? 'pick' : 'auto'}
                onChange={(v) => patch({ accounts: { [id]: { ...acct, ringTint: v === 'auto' ? null : '#4099FF' } } })}
                label={t('acct.color')}
                options={[{ value: 'auto', label: t('acct.color.auto') }, { value: 'pick', label: t('acct.color.pick') }]}
              />
              {acct.ringTint && (
                <input
                  type="color"
                  className="color"
                  aria-label={t('acct.color')}
                  value={acct.ringTint}
                  onChange={(e) => patch({ accounts: { [id]: { ...acct, ringTint: e.target.value.toUpperCase() } } })}
                />
              )}
            </Row>
            <Row title={t('acct.detailed')} subtitle={t('acct.detailed.sub')}>
              <Switch checked={acct.detailedCard} onChange={(v) => patch({ accounts: { [id]: { ...acct, detailedCard: v } } })} label={t('acct.detailed')} />
            </Row>
          </>
        )}
      </Group>

      <Group title={t('acct.connection')}>
        {info.credential === 'signIn' && <CopilotConnection s={s} t={t} />}
        {info.credential === 'apiKey' && <KeyConnection s={s} t={t} id={id} />}
        {info.credential === 'cli' && (
          <Row title={t('acct.connection')} subtitle={detected ? t('acct.detected') : undefined}>
            {snapshot && enabled ? availabilityText(snapshot.availability, t, info) : t('av.notConnected')}
          </Row>
        )}
      </Group>

      <Group title={t('acct.current')}>
        {!enabled ? (
          <Row title={t('acct.off')} subtitle={t('acct.offHint')} />
        ) : (
          <>
            {snapshot?.plan && <Row title={t('acct.plan')}>{snapshot.plan}</Row>}
            {windows.map((w) => {
              const spent = isSpent(w)
              const used = w.usedFraction ?? 0
              const pct = percentOf(w.usedFraction, false)
              const color = tintColor(windowTint(w, s.settings.panel.warningThreshold), dark ? false : true)
              const lines = amountLines(w, t, s.locale)
              const subtitle = [lines.amount, lines.over, w.resetsAt ? t('card.resets', { when: formatReset(w.resetsAt, s.locale) }) : null].filter(Boolean).join(' · ')
              return (
                <Row
                  key={w.id}
                  title={windowTitle(w, t)}
                  subtitle={subtitle || undefined}
                >
                  <span className="usage-mini">
                    <span className="usage-bar"><span style={{ width: `${Math.min(used, 1) * 100}%`, background: color }} /></span>
                    <span className="usage-pct" style={{ color: spent ? color : undefined }}>{pct === null ? '–' : `${pct}%`}</span>
                  </span>
                </Row>
              )
            })}
            {snapshot?.balance && <Row title={t('card.balance')}>{new Intl.NumberFormat(s.locale, { style: 'currency', currency: snapshot.balance.currency }).format(snapshot.balance.amount)}</Row>}
            {snapshot?.creditBalance && <Row title={t('card.creditBalance')}>{snapshot.creditBalance}</Row>}
            {windows.length === 0 && !snapshot?.balance && !snapshot?.creditBalance && snapshot && <Row title={availabilityText(snapshot.availability, t, info)} />}
            {snapshot && <Row title={t('acct.lastRead')}>{formatClock(snapshot.observedAt, s.locale)}</Row>}
            <Row title={t('acct.refresh')}>
              <Button onClick={() => window.pulse.refreshAll()}>{entry?.isRefreshing ? t('av.loading') : t('acct.retry')}</Button>
            </Row>
          </>
        )}
        {headline === null && null}
      </Group>

      {enabled && (
        <Group title={t('acct.diag')}>
          <Row title={t('acct.diag.latest')}>{diag ? `${availabilityText(diag.outcome, t, info)} · ${formatClock(diag.at, s.locale)}` : t('acct.diag.none')}</Row>
          {diag?.source && <Row title={t('acct.diag.source')}>{diag.source}</Row>}
          {snapshot?.origin === 'cache' && <Row title={t('acct.diag.cache')} subtitle={snapshot.staleReason ? availabilityText(snapshot.staleReason, t, info) : undefined} />}
        </Group>
      )}
    </>
  )
}

function KeyConnection({ s, t, id }: { s: SettingsState; t: T; id: ProviderId }) {
  const [value, setValue] = useState('')
  const [failed, setFailed] = useState(false)
  const saved = s.hasKey[id] === true
  const save = async (): Promise<void> => {
    if (value.trim() === '') return
    const ok = await window.pulse.saveSecret(id, value)
    setFailed(!ok)
    if (ok) setValue('')
  }
  return (
    <>
      <Row title={t('key.label')} subtitle={saved ? t('key.saved') : t('key.sub')}>
        <SecretField value={value} onChange={setValue} placeholder={t('key.placeholder')} showLabel={t('key.show')} hideLabel={t('key.hide')} onCommit={() => void save()} />
        <Button kind="primary" onClick={() => void save()} disabled={value.trim() === ''} style={{ marginLeft: 6 }}>{t('key.save')}</Button>
        {saved && <Button kind="danger" onClick={() => window.pulse.clearSecret(id)} style={{ marginLeft: 6 }}>{t('key.remove')}</Button>}
      </Row>
      {failed && <Banner tone="error">{t('cp.noStorage')}</Banner>}
    </>
  )
}

function CopilotConnection({ s, t }: { s: SettingsState; t: T }) {
  const [status, setStatus] = useState<CopilotStatus>({ phase: 'idle' })
  const signedIn = s.hasKey.copilot === true

  useEffect(() => {
    void window.pulse.copilotStatus().then(setStatus)
    return window.pulse.onCopilotStatus(setStatus)
  }, [])

  return (
    <>
      <Row title={t('cp.account')} subtitle={signedIn ? t('cp.signedIn') : t('cp.signedOut')}>
        {status.phase === 'waiting' ? (
          <Button onClick={() => window.pulse.copilotCancel()}>{t('cp.cancel')}</Button>
        ) : (
          <>
            <Button kind="primary" onClick={() => window.pulse.copilotStart()}>{signedIn ? t('cp.signInAgain') : t('cp.signIn')}</Button>
            {signedIn && <Button kind="danger" onClick={() => window.pulse.clearSecret('copilot')} style={{ marginLeft: 6 }}>{t('cp.signOut')}</Button>}
          </>
        )}
      </Row>
      {status.phase === 'waiting' && (
        <div className="device-box">
          <div className="device-label">{t('cp.code')}</div>
          <div className="device-code" aria-live="polite">{status.prompt.userCode}</div>
          <div className="device-actions">
            <Button onClick={() => window.pulse.copyText(status.prompt.userCode)}>{t('cp.copy')}</Button>
            <Button onClick={() => window.pulse.openExternal(status.prompt.verificationUrl)} style={{ marginLeft: 6 }}>{t('cp.openAgain')}</Button>
          </div>
          <p>{t('cp.codeHint')}</p>
          <p className="device-wait">{t('cp.waiting')}</p>
        </div>
      )}
      {status.phase === 'failed' && <Banner tone="error">{status.message}</Banner>}
      <Row title={t('cp.scope')} />
    </>
  )
}
