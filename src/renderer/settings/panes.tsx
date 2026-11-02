import { useEffect, useState } from 'react'
import type { Key, T } from '@shared/i18n'
import type { DeepPartial } from '@shared/ipc'
import { accountSettings } from '@shared/settings'
import { providerInfo, type AppSettings, type ProviderId, type SettingsState } from '@shared/types'
import { ProviderIcon } from '../shared/Icon'
import { Button, Group, Row, Select, Switch, TextField } from './ui'

export interface PaneProps {
  s: SettingsState
  t: T
  patch(p: DeepPartial<AppSettings>): void
}

export type PaneId = 'appearance' | 'rings' | 'position' | 'general' | 'notifications' | 'network' | 'about'

/** Title key and the row titles a pane holds, so search finds a setting by its name. */
export const PANES: Array<{ id: PaneId; section: 'panel' | 'app' | 'last'; title: Key; rows: Key[] }> = [
  { id: 'appearance', section: 'panel', title: 'set.pane.appearance', rows: ['set.size', 'set.spacing', 'set.light', 'set.bars', 'set.animate'] },
  { id: 'rings', section: 'panel', title: 'set.pane.rings', rows: ['set.pct', 'set.remaining', 'set.clock', 'set.red', 'set.alert'] },
  { id: 'position', section: 'panel', title: 'set.pane.position', rows: ['set.visible', 'set.collapse', 'set.position', 'set.snap', 'set.follow', 'set.order'] },
  { id: 'general', section: 'app', title: 'set.pane.general', rows: ['set.login', 'set.language'] },
  { id: 'notifications', section: 'app', title: 'set.pane.notifications', rows: ['set.warnAt', 'set.onExhausted', 'set.onReset', 'set.onFailure'] },
  { id: 'network', section: 'app', title: 'set.pane.network', rows: ['set.every', 'set.proxy'] },
  { id: 'about', section: 'last', title: 'set.pane.about', rows: ['set.version'] }
]

export function PaneView({ id, ...props }: PaneProps & { id: PaneId }) {
  switch (id) {
    case 'appearance': return <Appearance {...props} />
    case 'rings': return <Rings {...props} />
    case 'position': return <Position {...props} />
    case 'general': return <General {...props} />
    case 'notifications': return <Notifications {...props} />
    case 'network': return <Network {...props} />
    case 'about': return <About {...props} />
  }
}

function Appearance({ s, t, patch }: PaneProps) {
  const p = s.settings.panel
  return (
    <Group>
      <Row title={t('set.size')} subtitle={t('set.size.sub')}>
        <Select value={p.size} onChange={(v) => patch({ panel: { size: v } })} label={t('set.size')} options={[
          { value: 'small', label: t('set.size.small') }, { value: 'standard', label: t('set.size.standard') }, { value: 'large', label: t('set.size.large') }
        ]} />
      </Row>
      <Row title={t('set.spacing')} subtitle={t('set.spacing.sub')}>
        <Select value={p.spacing} onChange={(v) => patch({ panel: { spacing: v } })} label={t('set.spacing')} options={[
          { value: 'tight', label: t('set.spacing.tight') }, { value: 'standard', label: t('set.spacing.standard') }, { value: 'loose', label: t('set.spacing.loose') }
        ]} />
      </Row>
      <Row title={t('set.light')} subtitle={t('set.light.sub')}>
        <Switch checked={p.lightPanel} onChange={(v) => patch({ panel: { lightPanel: v } })} label={t('set.light')} />
      </Row>
      <Row title={t('set.bars')} subtitle={t('set.bars.sub')}>
        <Select value={p.barStyle} onChange={(v) => patch({ panel: { barStyle: v } })} label={t('set.bars')} options={[
          { value: 'continuous', label: t('set.bars.continuous') }, { value: 'segmented', label: t('set.bars.segmented') }
        ]} />
      </Row>
      <Row title={t('set.animate')} subtitle={t('set.animate.sub')}>
        <Switch checked={p.animateActivity} onChange={(v) => patch({ panel: { animateActivity: v } })} label={t('set.animate')} />
      </Row>
    </Group>
  )
}

function Rings({ s, t, patch }: PaneProps) {
  const p = s.settings.panel
  return (
    <Group>
      <Row title={t('set.pct')} subtitle={t('set.pct.sub')}>
        <Switch checked={p.showPercentages} onChange={(v) => patch({ panel: { showPercentages: v } })} label={t('set.pct')} />
      </Row>
      <Row title={t('set.remaining')} subtitle={t('set.remaining.sub')}>
        <Switch checked={p.showsRemaining} onChange={(v) => patch({ panel: { showsRemaining: v } })} label={t('set.remaining')} />
      </Row>
      <Row title={t('set.clock')} subtitle={t('set.clock.sub')}>
        <Switch checked={p.showWindowClock} onChange={(v) => patch({ panel: { showWindowClock: v } })} label={t('set.clock')} />
      </Row>
      <Row title={t('set.red')} subtitle={t('set.red.sub')}>
        <Select
          value={Math.round(p.warningThreshold * 100)}
          onChange={(v) => patch({ panel: { warningThreshold: v / 100 } })}
          label={t('set.red')}
          options={[60, 70, 75, 80, 85, 90].map((n) => ({ value: n, label: `${n}%` }))}
        />
      </Row>
      <Row title={t('set.alert')} subtitle={t('set.alert.sub')}>
        <Switch checked={p.dockAlertColor} onChange={(v) => patch({ panel: { dockAlertColor: v } })} label={t('set.alert')} />
      </Row>
    </Group>
  )
}

function Position({ s, t, patch }: PaneProps) {
  const p = s.settings.panel
  const shown = s.settings.enabled
  const move = (index: number, delta: number): void => {
    const next = [...shown]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    window.pulse.setEnabled(next)
  }
  return (
    <>
      <Group>
        <Row title={t('set.visible')} subtitle={t('set.visible.sub')}>
          <Switch checked={p.visible} onChange={(v) => patch({ panel: { visible: v } })} label={t('set.visible')} />
        </Row>
        <Row title={t('set.collapse')} subtitle={t('set.collapse.sub')}>
          <Switch checked={p.autoCollapse} onChange={(v) => patch({ panel: { autoCollapse: v } })} label={t('set.collapse')} />
        </Row>
        <Row title={t('set.position')} subtitle={t('set.position.sub')}>
          <Select value={p.position} onChange={(v) => patch({ panel: { position: v } })} label={t('set.position')} options={[
            { value: 'left', label: t('set.position.left') }, { value: 'free', label: t('set.position.free') }, { value: 'right', label: t('set.position.right') }
          ]} />
        </Row>
        <Row title={t('set.snap')} subtitle={t('set.snap.sub')}>
          <Switch checked={p.snapToEdges} onChange={(v) => patch({ panel: { snapToEdges: v } })} label={t('set.snap')} />
        </Row>
        <Row title={t('set.follow')} subtitle={t('set.follow.sub')}>
          <Switch checked={p.followActiveDisplay} onChange={(v) => patch({ panel: { followActiveDisplay: v } })} label={t('set.follow')} />
        </Row>
      </Group>
      <Group title={t('set.order')} footer={t('set.order.sub')}>
        {shown.length === 0 && <Row title={t('set.order.none')} />}
        {shown.map((id, i) => (
          <Row key={id} title={<span className="order-name"><ProviderIcon name={providerInfo(id).icon} size={16} />{providerInfo(id).name}</span>}>
            <Button onClick={() => move(i, -1)} disabled={i === 0}>↑ {t('set.order.up')}</Button>
            <Button onClick={() => move(i, 1)} disabled={i === shown.length - 1} style={{ marginLeft: 6 }}>↓ {t('set.order.down')}</Button>
          </Row>
        ))}
      </Group>
    </>
  )
}

function General({ s, t, patch }: PaneProps) {
  return (
    <Group>
      <Row title={t('set.login')} subtitle={t('set.login.sub')}>
        <Switch checked={s.settings.launchAtLogin} onChange={(v) => patch({ launchAtLogin: v })} label={t('set.login')} />
      </Row>
      <Row title={t('set.language')} subtitle={t('set.language.sub')}>
        <Select value={s.settings.language} onChange={(v) => patch({ language: v })} label={t('set.language')} options={[
          { value: 'system', label: t('set.language.system') }, { value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' }
        ]} />
      </Row>
    </Group>
  )
}

function Notifications({ s, t, patch }: PaneProps) {
  const n = s.settings.notifications
  const off = n.warnAt === 0
  return (
    <Group>
      <Row title={t('set.warnAt')} subtitle={t('set.warnAt.sub')}>
        <Select
          value={Math.round(n.warnAt * 100)}
          onChange={(v) => patch({ notifications: { warnAt: v / 100 } })}
          label={t('set.warnAt')}
          options={[{ value: 0, label: t('set.off') }, ...[50, 60, 70, 75, 80, 90, 95].map((x) => ({ value: x, label: `${x}%` }))]}
        />
      </Row>
      <Row title={t('set.onExhausted')} subtitle={t('set.onExhausted.sub')}>
        <Switch checked={n.onExhausted} onChange={(v) => patch({ notifications: { onExhausted: v } })} label={t('set.onExhausted')} />
      </Row>
      <Row title={t('set.onReset')} subtitle={t('set.onReset.sub')} disabled={off}>
        <Switch checked={n.onReset} disabled={off} onChange={(v) => patch({ notifications: { onReset: v } })} label={t('set.onReset')} />
      </Row>
      <Row title={t('set.onFailure')} subtitle={t('set.onFailure.sub')}>
        <Switch checked={n.onFailure} onChange={(v) => patch({ notifications: { onFailure: v } })} label={t('set.onFailure')} />
      </Row>
      <Row title={t('set.test')}>
        <Button onClick={() => window.pulse.testNotification()}>{t('set.test')}</Button>
      </Row>
    </Group>
  )
}

function Network({ s, t, patch }: PaneProps) {
  const net = s.settings.network
  // Typed text stays local; only a valid host and whole port replace the saved endpoint.
  const [host, setHost] = useState(net.host)
  const [port, setPort] = useState(net.port ? String(net.port) : '')
  useEffect(() => {
    setHost(net.host)
    setPort(net.port ? String(net.port) : '')
  }, [net.host, net.port])
  const commit = (): void => {
    const n = Number(port)
    if (host.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 65535) patch({ network: { host: host.trim(), port: n } })
  }
  return (
    <>
      <Group title={t('set.pane.network')}>
        <Row title={t('set.every')} subtitle={t('set.every.sub')}>
          <Select
            value={s.settings.refresh.seconds}
            onChange={(v) => patch({ refresh: { seconds: v } })}
            label={t('set.every')}
            options={[120, 300, 600, 900, 1800].map((x) => ({ value: x, label: t('set.minutes', { n: x / 60 }) }))}
          />
        </Row>
        <Row title={t('set.refreshAll')}>
          <Button onClick={() => window.pulse.refreshAll()}>{t('set.refreshAll')}</Button>
        </Row>
      </Group>
      <Group>
        <Row title={t('set.proxy')} subtitle={t('set.proxy.sub')}>
          <Select value={net.mode} onChange={(v) => patch({ network: { mode: v } })} label={t('set.proxy')} options={[
            { value: 'system', label: t('set.proxy.system') }, { value: 'none', label: t('set.proxy.none') }, { value: 'manual', label: t('set.proxy.manual') }
          ]} />
        </Row>
        {net.mode === 'manual' && (
          <>
            <Row title={t('set.proxy.host')}>
              <TextField value={host} onChange={setHost} onCommit={commit} width={180} label={t('set.proxy.host')} />
            </Row>
            <Row title={t('set.proxy.port')}>
              <TextField value={port} onChange={setPort} onCommit={commit} width={90} label={t('set.proxy.port')} />
            </Row>
          </>
        )}
      </Group>
    </>
  )
}

function About({ s, t }: PaneProps) {
  return (
    <>
      <Group>
        <Row title={t('set.version')}>{s.version}</Row>
        <Row title="GitHub"><Button onClick={() => window.pulse.openExternal('https://github.com/qunqin24/Pulse')}>qunqin24/Pulse</Button></Row>
      </Group>
      <Group>
        <Row title={t('set.about.privacy')} />
        <Row title={t('set.about.unofficial')} />
        <Row title={t('set.about.credits')} />
      </Group>
    </>
  )
}

export function accountEnabled(s: SettingsState, id: ProviderId): boolean {
  return s.settings.enabled.includes(id)
}

export { accountSettings }
