---
name: site-design
description: Visual design rules for the alexxburr Shopify theme, a contemporary industrial and lightly brutalist look (white, black and dark gray, hard rules, square corners, mono labels). Load before building, restyling or reviewing any UI in this theme, such as sections, snippets, CSS, buttons, the footer, header, product sheets, carousels or new pages.
---

# alexxburr design: contemporary industrial, a little brutalist

The site shows one-off grillz and jewelry pieces. The UI should feel like a
spec sheet or a fabrication shop's catalog: structural, plain, confident.
The photos carry the color and the chrome. The interface stays out of their
way.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| ink | `#111` | Body text, rules, primary buttons, active states |
| gray | `#555` | Labels, secondary text, arrows |
| mid | `#888` / `#bbb` | Disabled controls, hover text on black |
| hair | `#d9d9d9` | Hairline row dividers inside a cell |
| paper | `#fff` | Page and panel ground |
| photo | `#fafafa` | Behind product images (matches photo backgrounds, ~RGB 250) |
| hover-ink | `#333` | Hover on a black button |

- Mostly white, with black and dark gray accents.
- No blue, no gradients, no glow, no glossy or glass effects. If an accent
  is ever needed, use one flat color sparingly, never for large fills.
- Backdrops behind dialogs: `rgba(17, 17, 17, 0.6)`.

## Type

- **Display: Kontrapunkt** (Bold 700, Light 300; `var(--font-display)`), a
  squared slab face loaded by `snippets/site-fonts.liquid` from
  `assets/kontrapunkt-*.woff2`. Use it for key type: the footer wordmark,
  header menu links, section headings, piece titles, footer row values
  (Bold) and short intro lines (Light). It's CC BY-SA 3.0 (Kontrapunkt A/S),
  so keep the credit comment in the snippet and don't edit the glyphs.
- **Punch: Unsteady Oversteer** (`var(--font-punch)`, Ray Larabie, CC0),
  a squared techno face. Use it only for the footer wordmark (and other
  single big moments if asked). Always set it uppercase: its lowercase
  glyphs are inverted white-on-black blocks.
- Labels, keys, buttons and meta use the mono stack (`var(--font-mono)`) at
  11–12px, uppercase, `letter-spacing: 0.08em–0.12em`.
- Body copy (descriptions, paragraphs) stays on the theme body font.
- Index numbering (`01`, `02`, …) in labels and list keys is part of the
  look. Use it for sections and menus.
- The oversized wordmark (Unsteady Oversteer, sized from the viewport width,
  standing in the footer's live-water bar) is a single structural element.
  Don't repeat it everywhere.

## Shape and structure

- Square corners (`border-radius: 0`) on panels, buttons, arrows, inputs and
  dialogs. Grid tiles may keep a small radius until they're restyled.
- Structure comes from rules, not shadows: `2px solid #111` for major edges
  (top of the footer, dialog frames), `1px solid #111` between cells, and
  `1px solid #d9d9d9` hairlines between rows inside a cell.
- Lay content out as ruled grids: cells with a mono label on top. Stack them
  on phones and put them side by side from 750px with `border-left` dividers.
- No drop shadows, except a faint 1px outline to keep small controls (such as
  carousel dots) readable over photos.

## Components

- **Primary button**: black fill, white mono uppercase label, 1px `#111`
  border, square, label on the left and an arrow glyph (`→`, `\2192`) on the
  right (`display: flex; justify-content: space-between`). Hover `#333`.
- **Secondary button**: white fill, 1px `#111` border, black label, `↗`
  (`\2197`) for links that leave the current view. On hover it inverts to
  black.
- **List rows** (contact, menus): grid of key (mono, gray) / value (bold,
  uppercase) / arrow, separated by hairlines. Hover inverts the row to
  black on white text.
- **Header**: a white strip with a `2px` black base rule, split into cells by
  `1px` rules. It stays the same height at every scroll position, and
  nothing in it moves. Cells invert to black on hover. Icons are inline SVG
  line icons (1.75 stroke, square caps, mitred joins); don't use Font
  Awesome in new UI. Bodies are squared off: the bag is a square sack and
  the account icon has a round head on fully square shoulders. The logo is the black silhouette mark
  (`assets/alexxburr-mark.png`), with no circle or badge around it.
- **Door menu** (phones): heavy black doors (`#111`) that shut from both
  sides, accelerating in with a short jolt on impact. They leave a round
  window around the header logo, then the X draws in stroke by stroke over the
  menu button. The content on the doors is white Kontrapunkt rows with
  `#333` rules and mono keys.
- **Catalog grid** (homepage pieces): edge to edge, 1px black lines drawn by
  each tile, square photos on `#fafafa`, and a caption strip (mono index,
  Kontrapunkt title, mono date) that inverts on hover.
- **Hazard tape**: hard-stop diagonal black/white stripes
  (`repeating-linear-gradient` with no blending) for under-construction
  states such as the coming-soon pages. It's a pattern, not a gradient, so
  it's allowed.
- **Carousel** (`assets/carousel.js` / `carousel.css`): square white arrows
  with a 1px black border. Both always show, and the one with nowhere to go
  is `disabled` and dimmed (`#bbb`), never hidden. Square dots, black when
  current.
- **Dialogs / sheets**: white, square, `2px solid #111` frame (top edge only
  on phones, where it slides up), square close button with a 1px border.
- **Footer water** (`assets/site-footer.js`): the one place with
  physics-driven motion. It's black water in the bar's own color, with no
  highlights or gradients. A slightly lighter back wave (`#3a3a3a`) adds
  depth, and spray is small square droplets. It pauses off screen and holds
  still under reduced motion.
- Motion: short (0.15–0.2s), plain ease. Use a small translate for entry, no
  bounces.

## Theme gotchas

- The Testament global `button` rule sets `height: 50px`, margins and letter
  spacing. Reset `height`, `margin`, `padding`, `border-radius`,
  `letter-spacing` and `max-width` on every custom button.
- Global `a` and heading colors come from theme settings (headings are
  currently white). Set `color` explicitly on custom components.
- Reset `margin` and `padding` on `p`, `ul` and `li` inside custom sections. The
  theme stylesheet adds its own.
- Mobile first: write phone styles first, then add `min-width` media queries
  (750px, 990px or 1100px, 1400px).

## Don't

- Frutiger Aero, Y2K chrome, glass, bubbles, orbs, pills or sky-blue
  accents. That direction was dropped.
- Rounded pill buttons, gradients, heavy shadows or decorative blur.
- The old name "Exhibit Y". The brand is Alexx Burr / @alexxburrrr.
