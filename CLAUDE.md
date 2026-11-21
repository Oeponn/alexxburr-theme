# alexxburr theme

Shopify theme for exhibit-y-online.myshopify.com, built on the legacy Testament
theme (Liquid templates in `templates/*.liquid`, not JSON templates).

## Design direction

The site is being redesigned as a **chrome, white and light blue** website
drawing on two design languages:

- **Frutiger Aero**: glossy chrome and glass surfaces, white backgrounds,
  sky / light blue accents, soft gradients and highlights, bubbly rounded
  shapes.
- **Y2K Cyber Glacier**: icy, frosted translucency, cool silver-to-ice-blue
  gradients, crisp liquid-chrome highlights and a futuristic late-90s/2000s
  tech feel.

New UI should follow this style rather than the stock Testament look.

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
  `templates/index.liquid`). Two per row on phones; tapping a tile opens a
  sheet with the media and an inquire link.
- Swipe galleries (homepage sheet, product page on phones) use
  `assets/carousel.js` / `carousel.css`: mark the scroll-snap strip with
  `data-carousel` and it gets arrows, dots, and play-current-video-only.
- Product photos were background-matched to Open Monogram Tooth Caps photo 1
  (top-edge background ~RGB 250). New photos should match that.
- Files (Content → Files) holds only the current pieces' media and
  `alexxburr_logo.png`, which is the header logo, favicon and default share
  image (`images['alexxburr_logo.png']` in `snippets/social-meta-tags.liquid`).
  Reuse that file rather than uploading the logo again.
- Inquire links go to `/pages/contact?piece=<title>`; `snippets/contact.liquid`
  prefills the message from `piece`.
- The theme's global `button` rule sets `height: 50px` and margins; reset them
  on any custom button.
