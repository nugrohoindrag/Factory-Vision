# Morphic Design System

> A Material 3-based UI system for building modern, responsive, accessible web
> applications with a soft, premium, information-dense visual language.

Material Design 3 supplies the component architecture and interaction model.
Morphic supplies the visual language, tokens, patterns, templates and
implementation specification on top of it. This is **not** a Material 3 clone,
and it must never render as a default M3 dashboard.

The authoritative specification is [`Morphic-Design-System-adjusted.md`](./Morphic-Design-System-adjusted.md).
Section references below (§n) point into it.

---

## The one-line definition

**Material 3 + Soft Morphic Enterprise UI + Tonal Design System + Dense
Dashboard + Light/Dark Theme** (§35)

---

## Architecture (§17)

```
FOUNDATION → PRIMITIVE → COMPONENT → PATTERN → TEMPLATE → APPLICATION
```

| Layer | Location | Rule |
|---|---|---|
| 01 Foundations | `src/tokens` | Colour, type, space, shape, motion, a11y, z-index |
| 02–13 Components | `src/components` | Generic and domain-neutral (§4) |
| 14 Patterns | `src/patterns` | Combinations of Core; no one-off tokens (§16) |
| 15 Templates | `src/templates` | Screen compositions; generic business entities |
| Examples | `src/examples` | Industry vocabulary lives here, and only here |

`src/examples` is published from a **separate entry point** so installing the
system never pulls one industry's vocabulary into an application.

```ts
import { Button, ResourceCard } from '@morphic/design-system';
import { AlertSummary }          from '@morphic/design-system/patterns';
import { ExecutiveDashboard }    from '@morphic/design-system/templates';
import { WarehouseCard }         from '@morphic/design-system/examples';
import '@morphic/design-system/tokens.css';
```

---

## The domain-neutrality rule (§4)

Core never contains a component named after an industry. This is enforced by
`npm run audit:tokens`.

| Do not build in Core | Build instead | Industry version |
|---|---|---|
| Warehouse Card | `ResourceCard` | `examples/logistics` → `WarehouseCard` |
| Asset Card | `ResourceCard` | `examples/operations` → `AssetManagementResourceCard` |
| Delivery Card | `TransactionCard` | `examples/logistics` → `DeliveryCard` |
| Invoice Card | `TransactionCard` | — |
| Employee Card | `ProfileCard` | — |

An Example is a **configuration** of a Core component, never a fork. If you
find yourself copying markup out of Core to make an Example, the Core component
is missing a prop.

Core's generic entity family lives in `src/components/entity`:
`EntityCard` · `ResourceCard` · `TransactionCard` · `LocationCard` ·
`ProfileCard` · `ActivityCard` · `StatusCard` · `ProgressTrack`

---

## Tokens (§6, §8)

Components consume semantic tokens. Never a literal.

```css
/* Bad  */  background: #6FAF39;
/* Good */  background: var(--color-primary);
```

```
Component → Semantic Token → Theme → Actual Colour
```

Two naming schemes resolve to the same values — use either, prefer the short
one in new code:

| Short (§8 contract) | Full (M3) |
|---|---|
| `--color-primary` | `--md-sys-color-primary` |
| `--space-4` | `--md-sys-spacing-4` |
| `--radius-md` | `--md-sys-shape-corner-medium` |
| `--elevation-1` | `--md-sys-elevation-level1` |
| `--motion-standard` | composed from `--md-sys-motion-*` |

TypeScript consumers import the same contract from `src/tokens/tokens.ts`
(`COLOR_VAR`, `SPACING`, `RADIUS`, `MOTION_DURATION_MS`, `applyTheme`, …).

### Token files

| File | Holds |
|---|---|
| `foundations.css` | Spacing, typography, icon sizes, layout, density, breakpoints, z-index — **no colour** |
| `colors.css` | Light + dark base palettes, semantic states, chart palette |
| `themes.css` | The five presets, light and dark |
| `elevation.css` | Shape scale and the five elevation levels |
| `motion.css` | M3 easing and duration tokens, reduced-motion override |
| `contract.css` | The short `--color-*` / `--space-*` alias layer |
| `components.css` | Global reset, focus ring, and the `.morphic-*` surface classes. **Import this one.** |

---

## Themes (§2, §7)

Lime is the reference preset (§20), **not** the mandatory product identity.

```
Light · Dark · Lime · Blue · Violet · Orange · Rose · Custom
```

A preset swaps the **accent only**. Surfaces, background, borders and text stay
on the green tonal palette in every preset, because §20 requires that "green
should dominate the experience" and §15 keeps the pale green surface as
Morphic's visual identity.

A preset owns `primary` / `primary-container` / `primary-soft` / `on-primary`,
the chart primary and secondary, the hero card surface, and `inverse-primary`.
It must never override `background`, `surface`, `surface-container-*`,
`on-surface`, `on-surface-variant`, `outline`, `border`, `scrim`, `chart-grid`
or `chart-axis`.

```ts
import { applyTheme } from '@morphic/design-system';
applyTheme('dark', 'lime');
// → <html data-theme="dark" data-accent="lime">
```

Adding a Custom theme means copying one block in `themes.css` and overriding
the same token names. Never introduce a new token name at the component level.

### Reference palette (§20, §5)

| Role | Light | Dark |
|---|---|---|
| background | `#F0F7E5` | `#0F150C` |
| surface | `#F0F7E5` | `#191E14` |
| surface-container | `#E5EFD4` | `#272F20` |
| surface-container-high | `#D5E3BE` | `#3B4631` |
| primary (Lime preset) | `#6FAF39` | `#9CEC5D` |
| primary-container | `#B8EA86` | `#74AF42` |
| on-surface | `#254E09` | `#E6F0DD` |
| on-surface-variant | `#526940` | `#A1B49F` |

Two tones sit a step off the values printed in §20 because the spec's own
accessibility contract (§9) requires WCAG AA and the literal values miss it:

- `on-surface-variant` `#546B41 → #526940` — the spec tone reads 4.38:1 on
  `surface-container-high`, just under the 4.5:1 floor.
- `primary` keeps `#6FAF39` exactly. A sibling token
  `--color-primary-strong` (`#588B2D`) carries the AA-safe tone for focus
  rings, 1px boundaries and thin chart strokes, which need 3:1. `primary`
  itself is a fill, where `on-primary` supplies the text contrast.

### Surface text contract

`on-surface` and `on-surface-variant` are guaranteed AA through
**`surface-container-high`**. `surface-container-highest` is a **non-text**
surface — progress tracks, sliders, pressed state layers, skeleton bases.

---

## Shape (§7)

One scale. Do not mix unrelated radii — enforced by the audit.

| Token | Radius | Use |
|---|---|---|
| `--radius-xs` | 6px | Hairline bars, chart bar tops |
| `--radius-sm` | 10px | Small controls |
| `--radius-md` | 14px | Inputs, filters, buttons |
| `--radius-lg` | 18px | Nested cards, list containers |
| `--radius-xl` | 22px | Dashboard cards, charts |
| `--radius-hero` | 28px | Hero card |
| `--radius-pill` | 999px | Badges, chips, status dots |

Intent aliases (`--radius-card`, `--radius-chart`, `--radius-input`, …) mean a
caller never has to guess.

---

## Typography (§6)

Compact and information-dense. §32 forbids oversized typography; the audit caps
sizes at 11–28px and weight at 700.

| Role | Size | Weight |
|---|---|---|
| Page title | 24–28px | 650–700 |
| Section title | 16–18px | 600–650 |
| Metric value | 20–28px | 650–700, tabular numerals |
| Body | 13–14px | 400–500 |
| Metadata | 11–12px | 400–500 |
| Navigation | 12–13px | 500 |

Font: **Roboto Flex** (M3 fidelity) or **Inter**.

---

## Surfaces & elevation (§19, §21, §22)

Cards merge into the page through tonal contrast, not drop shadows.

- Most dashboard cards carry **no resting shadow** — surface contrast plus a
  1px low-contrast border.
- Elevation is reserved for floating menus, dropdowns, dialogs, hover states.
- Nested cards step **up one tonal level**, they do not gain a shadow.
- Borders are 1px and low-contrast. `1px solid #999` destroys the look.

```
Page background
 └── Main content surface
      ├── Hero card
      ├── Metric cards
      ├── Chart cards
      └── Data/list cards
           └── Small nested controls
```

---

## Motion (§18, §19)

Restrained. Never bouncy.

| Interaction | Duration | Token |
|---|---|---|
| Hover | 140ms | `--motion-duration-hover` |
| Button state | 160ms | `--motion-duration-button` |
| Card | 200ms | `--motion-duration-card` |
| Modal | 250ms | `--motion-duration-modal` |
| Page transition | 300ms | `--motion-duration-page` |
| Chart update | 550ms | `--motion-duration-chart` |

Easing: `cubic-bezier(0.2, 0, 0, 1)`. `prefers-reduced-motion` is honoured
globally in `motion.css`.

---

## Data visualisation (§29)

Charts should look native to the design system, not like default Chart.js or
Recharts output (§13).

Use **one dominant colour** plus a small semantic palette. §32 forbids rainbow
charts.

| Meaning | Token |
|---|---|
| Positive | `--color-chart-primary` |
| Positive strong | `--color-chart-secondary` |
| Warning | `--color-chart-tertiary` |
| Error | `--color-chart-quaternary` |
| Neutral | `--color-chart-neutral` |

`CHART_SERIES` exports the ordered palette — slice it, never extend it.

---

## Accessibility (§9)

Every interactive component defines keyboard behaviour, focus state, focus
visibility, screen-reader label, semantic HTML, colour contrast, disabled
state, error state, touch target, and reduced-motion behaviour.

- WCAG AA contrast — **verified by `npm run audit:contrast`** across all
  presets × light/dark
- Visible focus via `:focus-visible` using `--color-primary-strong`
- Minimum 44 × 44px touch target (`--md-sys-a11y-touch-target`)
- `prefers-reduced-motion` supported

`<Icon>` is decorative by default (`aria-hidden`). Pass `label` when the icon
carries the meaning on its own, e.g. inside an icon-only button.

---

## Responsive (§10, §25)

Components transform; they do not merely shrink.

| Breakpoint | Behaviour |
|---|---|
| Desktop ≥ 1200px | Full dashboard grid |
| Tablet 768–1199px | Sidebar becomes a rail, fewer columns, radius preserved |
| Mobile < 768px | Bottom/overlay nav, single column, table becomes list, filters scroll horizontally |

---

## Audits

Both gate CI and both currently pass.

```bash
npm run audit           # both
npm run audit:tokens    # §4 §6 §7 §8 §32
npm run audit:contrast  # §9
```

`audit:tokens` fails on a literal colour outside the token layer, an off-scale
radius, type outside 11–28px / weight > 700, or an industry-named component
inside Core.

`audit:contrast` checks 430 pairs across 5 presets × 2 modes at 4.5:1 for text
and 3:1 for UI boundaries.

---

## Anti-patterns (§32)

Do not generate any of these:

default Material 3 purple/blue · generic admin dashboard · Bootstrap-like cards
· sharp rectangular tables · excessive white backgrounds · glass blur ·
excessive gradients · heavy shadows · oversized typography · huge navigation ·
giant hero sections · rainbow charts · generic Tailwind dashboard aesthetics ·
random border radii · inconsistent icon sets

---

## Component specification standard (§5)

A production-ready component documents: Purpose · Anatomy · Variants · Sizes ·
States · Properties · Design Tokens · Typography · Colour · Spacing · Shape ·
Elevation · Interaction · Motion · Responsive Behaviour · Accessibility · Usage
Rules · Do · Don't · Implementation Notes.

This anatomy is a specification for AI and developers, not documentation for
designers.

---

## Before you add a component (§12)

1. Search the component catalog.
2. Check whether an existing component can be configured through variants.
3. Reuse existing tokens.
4. Reuse existing interaction patterns.
5. Create a new component **only** when the behaviour or anatomy is genuinely
   different.

### Implementation priority (§31)

```
1. Layout geometry   6. Density
2. Spacing           7. Chart composition
3. Colour system     8. Iconography
4. Typography        9. Motion
5. Card radius      10. Decorative details
```

> A visually attractive implementation that changes the grid, spacing, or card
> geometry is considered incorrect.

---

## Scripts

```bash
npm run dev       # Vite dev server with the component showcase
npm run build     # tsc + vite build
npm run audit     # token contract + contrast
```

## Licence

MIT. See [LICENSE](./LICENSE) and [ATTRIBUTION.md](./ATTRIBUTION.md).
