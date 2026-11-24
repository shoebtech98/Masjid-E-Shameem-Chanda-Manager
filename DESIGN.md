---
name: "Chanda Manager"
description: "Household collection tracking for Masjid E Shameem treasurers"
colors:
  paper: "#f7f7f2"
  surface: "#fffefa"
  surface-alt: "#eef1eb"
  text: "#203c32"
  muted: "#52675f"
  border: "#d3ddd6"
  grid: "#dfe4dc"
  green: "#203c32"
  green-muted: "#dce4df"
  gold: "#c49a45"
  on-gold: "#203c32"
  danger: "#b42318"
  danger-surface: "#fef0ee"
  on-green: "#ffffff"
typography:
  display:
    fontFamily: "IBMPlexSans_600SemiBold, sans-serif"
    fontSize: "27px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.5px"
  headline:
    fontFamily: "IBMPlexSans_600SemiBold, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "IBMPlexSans_600SemiBold, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "IBMPlexSans_400Regular, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBMPlexSans_600SemiBold, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.3px"
    textTransform: "uppercase"
  mono:
    fontFamily: "IBMPlexMono_500Medium, 'SFMono-Regular', monospace"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "8px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "26px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.on-gold}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  button-secondary:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "12px 13px"
---

# Design System: Chanda Manager

## Overview

**Creative North Star: "The Crouwel Grid"**

Crouwel Grid is a ledger-first mobile system built around a visible 26px measuring rhythm. The palette is paper-light and durable: pale cream surfaces, quiet blue-gray grid lines, deep green data panels, and a single ochre action plane that makes critical work stand out without becoming decorative. The interface treats every transaction as a record on a grid, with compact labels and tabular numerals aligned to the same rhythm for quick scanning on a phone.

The system is intentionally flat. Depth is conveyed through adjacent tonal surfaces, subtle borders, and the green collection hero, not shadows or floating cards. The app stays native and legible: clean fields, lowercase detail text, uppercase labels, and strong information hierarchy for treasurers verifying each household, contribution, and payment method. The design favors confidence, auditability, and routine accuracy over visual drama.

**Key Characteristics:**
- Pale paper base with blue-gray construction lines
- Deep green summary surfaces and data panels
- Ochre as the primary action accent
- IBM Plex Sans + IBM Plex Mono for readable ledger work
- 6/8/12/16/20/26px spacing rhythm aligned to a visible grid

## Colors

The palette balances archival paper, dark ledger ink, and one strong action color. Green is used for trusted totals and status surfaces; gold drives primary actions and deliberate calls to action.

### Primary
- **Deep green** (#203c32): foundational status surface and the default “collection total” panel; used on summary cards, confirmation states, and primary text in the main ledger.
- **Ochre action** (#c49a45): primary button accent and high-value action plane; reserved for “Record payment” and deliberate CTAs.
- **Gold-on-green contrast** (#203c32 over #c49a45): chosen to keep the action readable while preserving the gentle, paper-based world.

### Neutral
- **Paper** (#f7f7f2): app background and the base field for the grid system.
- **Surface** (#fffefa): standard card and field background.
- **Surface Alt** (#eef1eb): secondary tile or muted panel background.
- **Ink** (#203c32): primary text and icon color.
- **Muted** (#52675f): supporting labels, secondary copy, and placeholder text.
- **Border** (#d3ddd6): structure lines and card separators.
- **Grid** (#dfe4dc): quiet construction lines laid across the background.

### Semantic
- **Danger** (#b42318): critical states and destructive actions like sign out.
- **Danger Surface** (#fef0ee): tinted background for errors and warnings.
- **On Green** (#ffffff): text on green surfaces.
- **On Green Muted** (#dce4df): secondary text inside green collection panels.
- **On Gold** (#203c32): text on the ochre action plane.

### Named Rules
**The Ledger Rule.** Green and gold are used as system-level emphasis, not arbitrary decoration: green marks “trusted totals,” gold marks “do this now.”

## Typography

**Display Font:** IBM Plex Sans SemiBold (fallback: sans-serif)
**Body Font:** IBM Plex Sans Regular (fallback: sans-serif)
**Label/Mono Font:** IBM Plex Mono Medium (fallback: SFMono-Regular, monospace)

The type system is practical and sober: compact uppercase labels, clear body text, and monospace numbers for money amounts. The app keeps text near the neutral surface without becoming decorative, which maintains quick reading for treasurers on a phone.

### Hierarchy
- **Display** (600, 27px, 1.2): main screen titles and top-level section heads.
- **Headline** (600, 18px, 1.3): modal titles and dense list headings.
- **Title** (600, 15px, 1.35): household names, row titles, and card sub-heads.
- **Body** (400, 14px, 1.5): default content, supporting copy, and form helper text.
- **Label** (600, 12px, 0.3px uppercase): field labels and status callouts.
- **Mono** (500, 14-32px, tabular-nums): money, totals, and numeric ledger values; used in hero amount, rows, metrics, and split values.

### Named Rules
**The Tabular Rule.** Every amount uses IBM Plex Mono to give finance data a stable baseline and keep totals easy to compare at a glance.

## Layout

The app is built on a 26px visual grid with a 20px horizontal content gutter and 16px vertical spacing. Content is capped to a 680px max width on wider screens and centers on a paper background, while a 390px phone layout retains safe-area margins and dense content blocks.

The screen rhythm is consistent: page headers have 6px heading gaps, cards use 16px padding, and list rows use a 12px vertical rhythm with 10px row gaps. The collection overview card uses a strong full-width block with a split summary and status line, while forms use paired fields in an 8px/10px split row to preserve the ledger-like alignment.

## Elevation & Depth

Depth in this system is not created by floating shadow layers. The app uses flat surfaces, crisp separators, and tonal changes between paper, surface, and green panels. A green data block reads as elevated because it is a trusted financial surface, not because it casts a shadow.

The only explicit “lift” is the ochre action plane and selected green option chips, which bring focus through color contrast and contrast ratio rather than soft drop shadows.

## Shapes

The form language is restrained and durable: corners are nearly square with small rounding at 6px for fields and buttons and 8px for cards and larger blocks. Borders are light and continuous, and the app avoids ornamental curves, dramatic overlays, or pill-shaped surfaces. The result is native, utilitarian, and suited to frequent financial entry.

## Components

### Buttons
- **Shape:** 6px radius, 52px minimum height, 12px vertical and 16px horizontal padding, with a 2px slash accent on the primary action.
- **Primary:** ochre fill (#c49a45) on dark green text (#203c32); used for the main “Record payment” or “Save collection” actions.
- **Secondary:** pale green/neutral block (#eef1eb) with dark text; used for tertiary actions such as “Check server,” “Refresh,” and “Edit household.”
- **Danger:** warm tint (#fef0ee) with red text (#b42318); reserved for destructive or sign-out actions.
- **Plain:** transparent, text-only action that preserves the ledger feel without adding visual weight.

### Cards / Containers
- **Corner Style:** 8px radius with 1px border and 16px internal padding.
- **Background:** default cards use paper white (#fffefa) on paper (#f7f7f2) with subtle border separation.
- **Status Cards:** the collection summary card uses deep green with white/soft green text and a split row for cash and UPI.

### Inputs / Fields
- **Style:** 52px min height, 1px border, 6px radius, white surface background, compact uppercase labels above each field.
- **Focus:** selected state uses the same green palette through option chips and accent selection; input focus is kept visually simple, with the existing border/selection color system rather than a glow.
- **Error / Disabled:** error and warning blocks use red-tinted surfaces; disabled items fade to muted text and neutral backgrounds.

### Navigation
- **Style:** bottom tab bar with 68px minimum height, green active tint, muted inactive tint, 1px top border, and compact 10px labels.
- **Behavior:** standard mobile tab affordance with icon + label, preserving familiar iOS/Android conventions while retaining the ledger’s calm palette.

### Signature Components
- **ChoiceRow:** segmented option chips of equal height, 1px border, 6px radius, and green selected state; used for cash/UPI/split selection, active/inactive filters, and status toggles.
- **Metric:** small data tile with a compact uppercase label and tabular numeric value; used in report summaries.
- **Collection Hero:** a full-width summary card with total, cash/UPI split, and paid/pending status line.

## Do's and Don'ts

### Do:
- **Do** keep the base grid visible and the content rhythm consistent; maintain the 26px grid and 16px/20px padding model.
- **Do** use green summary panels for trusted totals and gold for the primary action plane.
- **Do** prefer compact uppercase labels and IBM Plex Mono for money, totals, and counts.
- **Do** keep forms and cards flat, bordered, and durable; use tonal differences instead of heavy shadows.

### Don't:
- **Don't** turn the system into a floating-card interface; the grid and ledger structure are the point.
- **Don't** add decorative shadows or gradients that fight the paper-and-grid material.
- **Don't** use the gold accent for general emphasis; reserve it for one action at a time.
- **Don't** let amounts or statuses drift off the shared numeric rhythm or lose their tabular baseline.
