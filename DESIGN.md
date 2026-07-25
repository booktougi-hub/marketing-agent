---
name: Monolith Precision
colors:
  surface: '#121414'
  surface-dim: '#121414'
  surface-bright: '#38393a'
  surface-container-lowest: '#0d0e0f'
  surface-container-low: '#1a1c1c'
  surface-container: '#1e2020'
  surface-container-high: '#292a2a'
  surface-container-highest: '#343535'
  on-surface: '#e3e2e2'
  on-surface-variant: '#c4c7c7'
  inverse-surface: '#e3e2e2'
  inverse-on-surface: '#2f3131'
  outline: '#8e9192'
  outline-variant: '#444748'
  surface-tint: '#c9c6c5'
  primary: '#c9c6c5'
  on-primary: '#313030'
  primary-container: '#0a0a0a'
  on-primary-container: '#7b7979'
  inverse-primary: '#5f5e5e'
  secondary: '#c8c6c5'
  on-secondary: '#313030'
  secondary-container: '#474746'
  on-secondary-container: '#b7b4b4'
  tertiary: '#c8c6c5'
  on-tertiary: '#303030'
  tertiary-container: '#0a0a0a'
  on-tertiary-container: '#7a7979'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#c9c6c5'
  on-primary-fixed: '#1c1b1b'
  on-primary-fixed-variant: '#474646'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1c1b1b'
  on-secondary-fixed-variant: '#474746'
  tertiary-fixed: '#e4e2e1'
  tertiary-fixed-dim: '#c8c6c5'
  on-tertiary-fixed: '#1b1c1c'
  on-tertiary-fixed-variant: '#474746'
  background: '#121414'
  on-background: '#e3e2e2'
  surface-variant: '#343535'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.05em
  code-md:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  container-max: 1440px
  gutter: 24px
  margin-page: 40px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style

The design system is engineered for high-performance AI SaaS environments where clarity and speed are paramount. It centers on a **Sophisticated Minimalist** aesthetic that draws inspiration from developer-centric tools like Linear and Raycast. The brand personality is "Intelligent, Trustworthy, and Fast," aiming to evoke a sense of calm authority through a reductionist interface.

Key stylistic pillars include:
- **Spatial Precision:** Heavy use of whitespace to separate concerns without visual noise.
- **Hairline Construction:** 1px borders and subtle dividers replace heavy shadows to define structure.
- **Data-First Hierarchy:** Functional elements are prioritized over decorative ones, using typography and contrast to guide the user's eye.
- **Subtle Modernism:** A blend of flat surfaces with micro-interactions and very soft glassmorphism for contextual overlays.

## Colors

The palette is anchored in a deep charcoal and neutral gray spectrum to provide a "pro-tool" environment that reduces eye strain. 

- **Surfaces:** The primary background is a rich `#0A0A0A`. Elevated containers use `#171717`.
- **Accent:** A single high-contrast **Indigo (`#4F46E5`)** is used sparingly for primary actions, active states, and critical data points.
- **Borders:** "Hairline" borders use `#262626` or `#404040` (for interactive states) to maintain structure without adding bulk.
- **Text:** High-contrast White (`#FFFFFF`) for headers, and Muted Gray (`#737373`) for secondary metadata to establish a clear information hierarchy.

## Typography

The design system utilizes **Inter** for all primary interface elements due to its exceptional legibility and systematic feel. For developer-focused data and labels, **Geist** is used to provide a technical, monospaced-adjacent aesthetic.

- **Scale:** Large headings use tight tracking (-0.02em) and semi-bold weights to feel "impactful yet quiet."
- **Body:** Standard body text is optimized at 14px for density-heavy dashboards, ensuring the UI remains compact.
- **Labels:** Small labels and tags utilize uppercase Geist with increased letter-spacing to distinguish them from standard prose.

## Layout & Spacing

The design system employs a **12-column fluid grid** for internal dashboard views, with a fixed max-width for landing or settings pages.

- **The 4px Rule:** All spacing increments are multiples of 4px to maintain a strict mathematical rhythm.
- **Density:** Dashboard layouts should prioritize high information density with 16px (stack-md) spacing between related cards and 32px (stack-lg) between distinct sections.
- **Responsive Behavior:** 
  - **Desktop (1024px+):** 12 columns, 40px page margins.
  - **Tablet (768px-1023px):** 8 columns, 24px page margins.
  - **Mobile (Up to 767px):** 4 columns, 16px page margins, stacking all sidebar content to top-navigation menus.

## Elevation & Depth

Hierarchy is established through **Tonal Layering** and **Subtle Elevation Shadows** rather than high-contrast shadows.

- **Level 0 (Background):** `#0A0A0A` - The base canvas.
- **Level 1 (Cards/Sidebar):** `#171717` with a 1px border of `#262626`.
- **Level 2 (Modals/Popovers):** `#1C1C1C` with a 1px border of `#404040` and a very soft, large-radius shadow (0px 10px 30px rgba(0,0,0,0.5)).
- **Glassmorphism:** Navigation blurs (Backdrop Filter: 20px) are used for sticky headers and command palettes to provide a sense of spatial awareness.
- **Interactive Depth:** Buttons and inputs should feel "flat" until interacted with, using a subtle inner-glow or slightly lighter border color on hover.

## Shapes

The shape language balances modern approachability with professional structure. 
- **Standard Radius:** 8px (rounded) for most buttons, inputs, and small widgets.
- **Large Radius:** 16px (rounded-lg) for main dashboard cards and container sections.
- **Interactive Elements:** Checkboxes and radio buttons use a tighter 4px radius to maintain a technical look.
- **Consistency:** Avoid pill-shapes for buttons to maintain the sophisticated, geometric aesthetic; reserve pill shapes strictly for status "Chips" or "Badges."

## Components

- **Buttons:** 
  - *Primary:* Solid Indigo (`#4F46E5`) with White text. No gradients.
  - *Secondary:* Ghost style with 1px border (`#262626`) and subtle hover transition to `#404040`.
- **Input Fields:** 1px hairline border, dark background (`#0A0A0A`). Focus state uses a 1px Indigo border and a 2px outer glow (Indigo at 10% opacity).
- **Cards:** Defined by a 1px border (`#262626`). Use padding of 24px for desktop dashboard tiles.
- **Chips/Badges:** Small, monochromatic labels with a subtle background (`#262626`) and muted text. 
- **Lists:** Clean rows separated by 1px dividers. Hovering over a row should change the background to a slightly lighter gray (`#1C1C1C`).
- **Command Palette:** A central UI pattern (K-bar style). High blur backdrop, centered, with 12px corner radius and Geist typography for keyboard shortcuts.
- **AI-Indicator:** When AI is processing, use a subtle "shimmer" effect on the hairline border of the relevant container rather than a spinning icon.