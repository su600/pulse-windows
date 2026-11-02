# Pulse for Windows

<p align="center"><a href="README.zh-CN.md">简体中文</a> · <b>English</b></p>

> **Based on another project.** This is an **unofficial, independent Windows port** of **[Pulse](https://github.com/qunqin24/Pulse) by [qunqin24](https://github.com/qunqin24)** (Apache-2.0), a macOS app. It was built by studying that repository — its UI/behaviour docs (`Docs/ui/*`, `Docs/providers/*`), screenshots, provider response fixtures and the provider icons — and re-implementing it for Windows. The original is Swift/SwiftUI and cannot run on Windows, so the code here is a fresh Electron + React + TypeScript implementation, not a build of the original sources. The design, interaction details and provider-reading rules belong to the original author; I am not affiliated with them. If you like this, please also star the [original Pulse](https://github.com/qunqin24/Pulse). Inspired in turn by a UI concept from [Vinz (@hivinz_)](https://x.com/hivinz_/status/2092996055248126353), as credited by the original project.

A Windows port of [Pulse](https://github.com/qunqin24/Pulse) — a small, local-first floating monitor for AI coding quota. A slim black rail sits on the edge of your screen with one ring per service; point at a ring and a card shows each limit and when it resets. No Pulse account, no Pulse server.

> **How it was made.** This whole project — code, tests and docs — was written with **[Claude Code](https://claude.com/claude-code)** using the **Claude Sonnet 5.5** model, directed by [@su600](https://github.com/su600). Treat it accordingly: the unit tests pass, but not every behaviour has been exercised on real accounts and hardware yet (see *Verification status* below).

Built from the repository's own UI and behaviour docs (`Docs/ui/*`, `Docs/providers/*`) and the Windows design brief, not by compiling the Swift sources (they are AppKit/SwiftUI and cannot run on Windows). Stack: **Electron + React + TypeScript**.

> Not an official integration of any service. The usage endpoints are not public APIs and can change without notice.

**Download:** ready-made Windows builds are on the [Releases page](https://github.com/su600/pulse-windows/releases) (installer and portable exe, unsigned).

## What works

| Area | Status |
|---|---|
| **GitHub Copilot** | Device-code sign-in (`read:user` only), the three monthly quotas (Premium requests / Chat / Completions), plan name (Pro vs Pro+ read from `access_type_sku`), credit usage (`7,360 of 7,000 credits`), overage and unissued-lane rules. Overage on credit-billed accounts is also shown in dollars at **100 credits = $1** — that rate is a user-supplied conversion, not something the API reports (it reports credits only) |
| **Claude Code** | Reads the OAuth login Claude Code stored (`.claude\.credentials.json`), 5-hour / weekly / per-model windows, plan name |
| **Codex** | Reads `.codex\auth.json`, primary/secondary + per-model windows, plan, credit balance |
| **DeepSeek** | Prepaid balance via a pasted API key (encrypted with Windows DPAPI) |
| Floating rail | Dock left/right/free, snap to edges, auto-collapse to a sliver, hover card, click ring to refresh, drag, right-click menu, light/black panel, three sizes and spacings, continuous/segmented bars, optional "time until reset" arc, show used/left, configurable red threshold |
| Data lifecycle | Single timer for the earliest due account (never a fixed fast poll), one read per account, superseded reads discarded, last-good cache with stale marking, expired windows dropped, rate-limit back-off, refresh on wake/unlock |
| Notifications | Warn-at line, limit spent, limit back, repeated read failures — de-duplicated and persisted across restarts, all **off** by default |
| Settings | Sidebar with search, first-run chooser (nothing is read until you choose), per-account panes with connection diagnostics, English and 简体中文 |
| Privacy | Secrets only in `safeStorage` (DPAPI), never in settings, logs or diagnostics; unselected services are never read |

Not ported yet: the other ~70 providers, Token spend/recaps, extensions, `--json` CLI output, service-status pages, animated bot marks, Liquid Glass/notch docking, hide-in-full-screen. The adapter interface (`src/main/providers/types.ts`) is the seam for adding more.

## Run it

> **Do not keep this folder under `Desktop`.** On the development PC, Electron's `electron.exe` crashes at startup (exit `0x80000003` / `0xC0000005`, no log) when it sits anywhere below `C:\Users\<you>\Desktop`, and runs fine from `C:\`, the user-profile root or `AppData`. Measured with the same binary copied to each place; the cause on the Desktop side was not identified. Keep the project at e.g. `C:\Users\<you>\pulse-windows` and start it from the Desktop *shortcut* (run `scripts\make-desktop-shortcut.ps1` once; it points to `start-pulse.vbs`).

**Starting without a console window:** `start-pulse.vbs` (what the shortcut runs) launches Electron directly and only rebuilds silently in the background when `src\` is newer than the build or `out\` is missing; on failure it shows a message box and writes `start-error.txt`. `start-pulse-debug.cmd` does the same with a visible console and prints the startup log (`%APPDATA%\Pulse\pulse.log`) — use it when something does not appear.

```bash
npm install
npm run dev          # Electron, with hot reload
npm run dev:web      # the panel/settings in a plain browser with a mock backend (?mock=demo|real|setup)
npm test             # 53 unit tests
npm run dist         # NSIS installer + portable exe in dist/ (~90-100 MB, unsigned)
```

`PULSE_DEMO=1` starts the app with six synthetic rings (separate profile, no network) — handy for screenshots.

**Building an exe:** run `npm run dist`. In `dist\` you get `Pulse Setup 0.1.0.exe` (installer; choose the folder, installs per-user, no admin rights) and `Pulse 0.1.0.exe` (portable, no install). Both are **unsigned**, so Windows SmartScreen may warn about an unknown publisher the first time: choose *More info → Run anyway*. As above, don't run them from under `Desktop`.

First launch opens the chooser. Pick services, then **Done**. For Copilot, open its pane and click **Sign in…**: the code is copied to the clipboard, GitHub opens in your browser, paste the code there. (GitHub never pre-fills it; that is deliberate on their side.)

## Layout

```
src/shared     domain model, colour/headline/expiry rules, alert rules, geometry, i18n, settings sanitising (pure, unit-tested)
src/main       Electron main: panel window controller, tray, coordinator (refresh), store (settings/secrets/cache), providers/
src/preload    the one typed bridge (window.pulse)
src/renderer   panel/ (rail, ring, card) and settings/ (shell, panes, setup)
tests          provider parsing (fixtures), coordinator, rules, alerts, layout, settings, device login
```

Design rules carried over from Pulse and enforced by tests: the window never resizes when a card opens; no reading is drawn as empty, never as 0%; the ring colour means closeness to the limit, not the brand; `exhausted` is the provider's word, not "100%"; windows past their reset are never shown as current.

## Verification status

Unit tests, type-check and the production build pass, and the renderers were checked visually in a browser against the Pulse screenshots. Codex was read live against a real login on the development PC. The real Electron app was then run (outside `Desktop`, see above): it starts, creates the tray icon and, on first run, opens the settings/chooser window; in demo mode the transparent always-on-top panel renders and the hover card opens (see `docs/screenshots/real-window-hover.png`). **Still unverified because it needs a person with a mouse:** dragging and edge snapping, click-through of the transparent area, the right-click menu, real notifications, and a live Copilot sign-in — please try those and report anything off.

Known gap: Claude Code's usage needs `claudeAiOauth` in `.claude\.credentials.json`. If your Claude Code keeps its login elsewhere, Pulse says "no saved login" rather than showing 0. The status-line and desktop-session routes of the macOS app are not ported.

## License

Apache-2.0, see `LICENSE`. This port is derived from Pulse by qunqin24 (Apache-2.0): provider icons are from [Lobe Icons](https://github.com/lobehub/lobe-icons) (see `THIRD_PARTY_NOTICES.md`), and the Pulse mark is the original's. The Apache license does not grant trademark rights to any vendor's name or logo.
