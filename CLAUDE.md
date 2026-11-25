# alexxburr theme

Shopify theme for exhibit-y-online.myshopify.com, built on the legacy Testament
theme (Liquid templates in `templates/*.liquid`, not JSON templates).

## Design direction

**Contemporary industrial, a little brutalist**: white ground, black and dark
gray type and rules, square corners, mono index labels, no gradients, gloss or
blue accents. Fonts load from `snippets/site-fonts.liquid`: Kontrapunkt is the
accent / display face (`var(--font-display)`), Unsteady Oversteer is the
punch face for the footer wordmark only (`var(--font-punch)`, always
uppercase), and labels use a mono stack (`var(--font-mono)`). The full rules (palette, type, components, do / don't)
are in the `site-design` skill (`.claude/skills/site-design/SKILL.md`); load
it before building or restyling UI. New UI should follow it rather than the
stock Testament look. (An earlier Frutiger Aero / chrome-and-blue direction
was dropped; don't bring it back.)

## Deploying

- The live theme `alexxburr-theme/main` is connected to GitHub
  (`Oeponn/alexxburr-theme`, branch `main`). Pushing to `main` deploys to the
  live store, and edits made in the Shopify admin come back as
  "Update from Shopify" commits, so pull before working.
- Preview work on the development theme with `shopify theme push --development`
  (or `shopify theme dev`) before pushing to `main`.
- Store data (pages, redirects, etc.) can be changed with
  `shopify store execute --store exhibit-y-online.myshopify.com` (Admin GraphQL;
  add `--allow-mutations` for writes). Auth: `shopify store auth`.
- `config/settings_data.json` is rewritten by the theme editor; keep edits to it
  small.

## Contact

- Instagram https://www.instagram.com/alexxburrrr/ or call/text
  (248) 228-5162. The site's old name was Exhibit Y (exhibity.co); don't
  reintroduce it. The only remaining trace is the permanent
  `exhibit-y-online.myshopify.com` store address, which can't change.

## Pages

- Header menu (`main-menu`) splits around the logo: WORK, BUILDER | SHOP,
  CONTACT (Instagram is the header icon, not a menu item). `sections/header.liquid` + `assets/header.css`: one ruled white
  strip, fixed height (nothing resizes on scroll), logo cell dead centre,
  equal-width link cells, square icon cells on the outer edges (desktop:
  Instagram + search left, account + bag right; phones: menu + search left).
  Icons are inline SVG. The logo is `assets/alexxburr-mark.png`, a black
  silhouette of `alexxburr_logo.png` (which stays the favicon / share image).
- Phone menu: `sections/mobile-navigation.liquid` (still that name, but it's
  the door menu now) + `assets/door-menu.{css,js}`. The menu button
  (`[data-door-open]`) shuts two black doors from the sides, with a round
  window (a hard-edged mask hole, half on each door) around the header logo. The X draws in stroke by stroke where the
  menu button was, and the index fades up. Its section type is `door-menu`,
  so theme.js's Testament slide-out (which pushed `#panel` sideways) never
  starts. The doors run 50vh past the bottom of the screen: iOS Safari draws
  the page behind its see-through bottom toolbar, below where a fixed box
  ends (the search overlay's backdrop does the same).
- Live search: the header search overlay and the door menu's search field
  show results as you type (`assets/predictive-search.{js,css}`). It's
  Shopify's built-in predictive search (`routes.predictive_search_url`,
  products and pages, no app needed) rendering
  `sections/predictive-search.liquid` through the Section Rendering API. Any
  form with `data-predictive-search="<results box id>"` gets it.
- Footer: `sections/site-footer.liquid` + `assets/site-footer.css`. Ruled
  three-cell grid (studio tagline, contact rows for Instagram / text / call,
  `footer` menu as an index), then the "shore": a full-width Unsteady
  Oversteer wordmark standing in the black bottom bar, whose top edge is live
  water (`assets/site-footer.js`: spring-column wave sim with swell, spray,
  and pointer / tap / scroll disturbances; it runs only while visible and is
  a still frame under reduced motion). Contact details are section settings.
  The old Testament `footer` section is gone.
- `/pages/builder`: the 3D grillz builder. `templates/page.builder.liquid`
  renders `sections/grillz-builder.liquid` + `assets/grillz-builder.{css,js}`
  and `assets/grillz-builder-cast.js`. The cast (two plaster arches, ten
  teeth each, US tooth numbers 4-13 / 20-29, on trimmed bases with eased
  edges that cover the whole gum) is sculpted in code, not loaded. Caps are
  offset copies of each crown (fangs wrap the crown, then run on into a
  rounded point along one smooth, convex curve: a dip there reads as a
  groove in polished metal), and a shader on them cuts the open-face /
  heart / star windows and diamond-cut facets.
  A tooth's style is a cut (solid, heart, star, diamond, iced, solo stone)
  plus two switches, fang and open face (heart and star swap with open
  face). `capLook` in the cast module turns a style into the cap's shape,
  window, finish and stone layout. A design is one metal plus a style per
  tooth (a token: the cut's letter, then `F` for fang and `O` for open
  face). It's kept in the URL hash and localStorage as a short share code
  (`#g=121X5A`, 17 characters at most): the whole design packed into one
  number, written in base 62 after a version digit (`SHARE` in
  `grillz-builder.js`). Each version's lists of metals and styles are fixed:
  to add a cut or metal, add a new version and keep the old one so links
  already shared still open. The older readable spelling
  (`#g=14y.--sFdFsO----.----------`, with `f` / `o` for fang / open face)
  still reads. Sets swap in a whole design with the loaded
  style; with Remove loaded they take just their own teeth's caps off
  (greyed out when there's nothing to take), and the HUD's Reset clears
  every cap. The plaster has a shader grain, the stones a
  diamond shader (refraction, pavilion bounces, dispersion), and the HUD
  switches between studio light (key light, shadows, hot lamps the stones
  spark in) and even light (soft dome, no shadows), remembered in
  localStorage. The cut, metal and set lists live in the section markup
  (the script reads them from the buttons); a metal's 3D look is its
  `data-color` / `data-rough`. The stage is
  `100svh - header` with a fixed-height dock, so nothing shifts; keep
  `--gb-header` in step with the header's height settings. three.js comes
  from jsDelivr through an import map (the cast module's URL is written
  without `| json` so `shopify theme dev` can rewrite it). Submitting a
  design for a quote is a later slice.
- `/pages/shop`: `templates/page.shop.liquid`, rendering
  `sections/coming-soon.liquid` (+ `assets/coming-soon.css`), an industrial
  spec-sheet placeholder. Heading and text come from the page's own title
  and content in the admin, so edit those rather than the section.

- `/pages/test` (redirect from `/test`): `templates/page.test.liquid`, the
  spinning grillz WebGL canvas (`sections/grillz-canvas.liquid`,
  `assets/grillz-canvas.*`). Moved off the homepage; it's a test bed, not
  linked from navigation.

## Products

- The store presents past work, not stock. Every product is a one-off piece
  (grillz, tooth caps, the odd pendant) from @alexxburrrr on Instagram, tagged
  `archive` + `featured-work`, in the `featured-works` collection (manual
  order, newest first), published to the Online Store only.
- They use the `product.archive` template (`sections/archive-product.liquid`):
  no price or buy button, just an "Inquire" link. Variants are $0 with tracked
  inventory at 0 and overselling off, so they can't be bought.
- `custom.made_on` (date) holds when the piece was posted.
- Homepage: `sections/featured-works.liquid` (static, top of
  `templates/index.liquid`). Ruled catalog grid, edge to edge: square tiles,
  caption strip with index, title and `custom.made_on` as MM.YY. Two per row
  on phones, three on tablets, four on desktop. Tapping a tile opens a sheet
  with the media and an inquire link.
- Swipe galleries (homepage sheet, product page on phones) use
  `assets/carousel.js` / `carousel.css`: mark the scroll-snap strip with
  `data-carousel` and it gets arrows, dots, and play-current-video-only. Both
  arrows always show; the one at either end is disabled (dimmed), not hidden.
- Product photos were background-matched to Open Monogram Tooth Caps photo 1
  (top-edge background ~RGB 250). New photos should match that.
- Search (`sections/search-template.liquid` + `assets/search-page.css`,
  full width via `layout/theme.liquid`): the catalog look of the homepage
  grid, with a ruled search bar, no-results actions (builder, contact) and
  ruled pagination. Tile tags everywhere (`.icn` in `stylesheet.css.liquid`)
  are square mono labels on the photo's corner. Archive pieces say
  "Archive" and show their `made_on` date instead of "Sold out" / "$0.00",
  in search and in `snippets/product-listing.liquid`.
- Files (Content → Files) holds only the current pieces' media and
  `alexxburr_logo.png`, which is the header logo, favicon and default share
  image (`images['alexxburr_logo.png']` in `snippets/social-meta-tags.liquid`).
  Reuse that file rather than uploading the logo again.
- Inquire links go to `/pages/contact?piece=<title>`; `snippets/contact.liquid`
  prefills the message from `piece`. The contact page
  (`sections/contact-page-template.liquid` + `assets/contact-page.css`) is a
  big title on a heavy rule with two ruled cells: the page's own content on
  the left, square-ruled form fields with mono index labels on the right.
- The theme's global `button` rule sets `height: 50px` and margins; reset them
  on any custom button.
