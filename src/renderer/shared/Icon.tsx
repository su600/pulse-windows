import type { CSSProperties } from 'react'

const urls = import.meta.glob('../../../resources/icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

const byName: Record<string, string> = {}
for (const [path, url] of Object.entries(urls)) {
  const name = path.split('/').pop()!.replace(/\.svg$/, '')
  byName[name] = url
}

/**
 * A provider mark. The SVGs are single-colour `currentColor` artwork, so they
 * are drawn as a mask over the current text colour: the icon takes the
 * surrounding ink and carries no colour of its own.
 */
export function ProviderIcon({ name, size, style }: { name: string; size: number; style?: CSSProperties }) {
  const url = byName[name]
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        flex: 'none',
        backgroundColor: 'currentColor',
        WebkitMaskImage: url ? `url("${url}")` : undefined,
        maskImage: url ? `url("${url}")` : undefined,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        ...style
      }}
    />
  )
}
