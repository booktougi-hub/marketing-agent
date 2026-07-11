---
name: Midnight Flow
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#bdc8d1'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#87929a'
  outline-variant: '#3e484f'
  surface-tint: '#7bd0ff'
  primary: '#8ed5ff'
  on-primary: '#00354a'
  primary-container: '#38bdf8'
  on-primary-container: '#004965'
  inverse-primary: '#00668a'
  secondary: '#4de082'
  on-secondary: '#003919'
  secondary-container: '#00b55d'
  on-secondary-container: '#003e1c'
  tertiary: '#becee4'
  on-tertiary: '#233143'
  tertiary-container: '#a3b2c7'
  on-tertiary-container: '#364557'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c4e7ff'
  primary-fixed-dim: '#7bd0ff'
  on-primary-fixed: '#001e2c'
  on-primary-fixed-variant: '#004c69'
  secondary-fixed: '#6dfe9c'
  secondary-fixed-dim: '#4de082'
  on-secondary-fixed: '#00210c'
  on-secondary-fixed-variant: '#005227'
  tertiary-fixed: '#d4e4fa'
  tertiary-fixed-dim: '#b9c8de'
  on-tertiary-fixed: '#0d1c2d'
  on-tertiary-fixed-variant: '#39485a'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  headline-xl:
    fontFamily: Hanken Grotesk
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  mono-label:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  container-max: 1280px
  gutter: 20px
---

## Brand & Style
The design system is engineered for the high-velocity world of solo developers and entrepreneurs. It embodies a **"Command Center"** aesthetic—sophisticated, focused, and high-performance. The brand personality is that of an expert co-pilot: quiet when backgrounded, but strikingly clear when surfacing insights.

The design style leverages **Modern Dark Mode** principles mixed with **Glassmorphism**. It utilizes deep obsidian layers to reduce eye strain during long working sessions, while employing electric accents and subtle glows to guide the user's focus toward high-value marketing actions. The result is a UI that feels like a precision instrument—reliable, technical, and premium.

## Colors
The palette is built on a foundation of "Obsidian" and "Deep Charcoal" to create an infinite sense of depth.

- **Primary (Electric Blue):** Used for primary actions, active states, and critical paths. It represents the "Flow" and energy of the assistant.
- **Secondary (Soft Mint):** Reserved for success states, growth metrics, and "Go-Live" indicators.
- **Neutral/Surface:** A range of deep slates used to distinguish between different functional areas of the interface.
- **Accents:** Low-opacity glows using the primary color are used to highlight active containers or hovering states, mimicking a backlit hardware interface.

## Typography
The typography strategy prioritizes density and legibility. By using **Hanken Grotesk** for headings, we achieve a sharp, contemporary look that feels engineered. **Inter** handles the heavy lifting of the UI text, providing a neutral, systematic clarity.

- **Tight Tracking:** Headlines should use a negative letter-spacing (approx -1% to -2%) to reinforce the "tight" and professional feel.
- **Hierarchy:** Use the `label-md` for secondary metadata and "mono-label" (using a monospaced font) for technical values like API keys, performance metrics, or timestamps to lean into the developer-centric vibe.

## Layout & Spacing
The spacing system is based on a **4px baseline grid**, ensuring mathematical precision across all components.

- **Desktop:** 12-column grid with a 1280px max-width. Margins are generous (40px) to allow the "Obsidian" background to frame the content.
- **Tablet:** 8-column grid with 24px margins. Glassmorphic sidebars collapse into bottom navigation or "hamburger" menus.
- **Mobile:** 4-column grid with 16px margins.
- **Grouping:** Use the `md` (16px) unit for internal component padding and `lg` (24px) for spacing between distinct functional blocks.

## Elevation & Depth
In this design system, depth is communicated through **luminance and translucency** rather than traditional heavy shadows.

- **Surface Layers:** The background is `#020617`. Cards and panels use `#0f172a`.
- **Glassmorphism:** Overlays (modals, dropdowns) use a semi-transparent background with a `backdrop-filter: blur(12px)`.
- **Borders:** Surfaces are defined by 1px solid borders. Base borders use `white/5%`. Featured or "active" surfaces use `primary/20%` with a very subtle outer glow (4px blur, primary color at 10% opacity).
- **Z-Index Strategy:** Higher elevation levels are slightly lighter in color, creating a "stepping closer to the light source" effect.

## Shapes
The shape language is defined by "Precise Geometry." We use a standard **8px (0.5rem)** radius for most UI elements (buttons, inputs, cards) to maintain a professional and rigorous feel.

- **Small elements:** Tags and small icons use 4px (Soft).
- **Large containers:** Hero sections or main dashboard panels use 16px (rounded-lg) to soften the edges of the overall layout.
- **Avoid Pills:** Except for specific status badges, pill shapes are avoided to keep the interface feeling like a technical tool rather than a consumer app.

## Components
- **Buttons:** Primary buttons use a solid Electric Blue fill with dark text. Secondary buttons use a ghost style (1px border) with a subtle primary-color glow on hover.
- **Inputs:** Dark backgrounds (`#020617`) with a 1px border. On focus, the border transitions to Electric Blue with a soft 2px outer glow.
- **Cards:** No background shadow. Instead, use a subtle gradient border from top-left to bottom-right (white/10% to white/0%).
- **Chips/Badges:** Use "Mono" typography. Status badges for "Success" should use the Soft Mint accent with a low-opacity background tint (Mint/10%).
- **Lists:** Clean rows separated by 1px `#1e293b` dividers. Hover states should slightly lighten the entire row background.
- **Specialty Component - "The Pulse":** A small, animated Soft Mint dot next to "Live" marketing campaigns to signify the assistant is actively monitoring data.