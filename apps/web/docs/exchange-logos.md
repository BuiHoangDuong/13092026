# Exchange logos

These PNGs are served locally at `/exchange-logos/<slug>.png`. The seed sets that
root-relative path in both halves of the exchange upsert. No external image host
is used at runtime. Exchanges created through the admin UI keep `logoUrl = null`
and render the existing gradient/name placeholder.

All three assets use horizontal wordmarks with transparent backgrounds. They are
centered in the same padded bounding box (18% of the square tile's height) with
`object-contain`, preserving each logo's proportions. Logo tiles use the theme's
dark `bg-card` surface; null-logo tiles retain their gradient and exchange name.

Assets retrieved on 2026-09-16 and converted to PNG without changing the artwork:

| File | Source | Size |
| --- | --- | --- |
| `binance.png` | [Horizontal logo SVG on Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Binance_logo.svg); fallback because the official newsroom returned an empty response and its available icon has a baked background | 632 × 127 |
| `mexc.png` | [Horizontal white logo](https://static.mocortech.com/image-host/index/lockup-horizontal-white.be49f02b2109.webp) from [MEXC brand guidelines](https://www.mexc.com/en-GB/brand-guidelines) | 518 × 96 |
| `bybit.png` | `bybit-logo-dark.svg` from the [official logo download](https://drive.google.com/file/d/1Qc4kPSQzDRUt4F_SLUeTXivShm1x4rVW/view) linked from [Bybit press](https://www.bybit.com/press) | 347 × 120 |

The names and logos belong to their respective owners. Source URLs above are
provenance only; the application does not fetch them.

Keep these notes in `apps/web/docs/`, outside the publicly served asset directory.

To add a logo, commit a PNG under `apps/web/public/exchange-logos/`, set its local
path in the seed, build and deploy the app, then migrate/re-seed the target
database. Admin forms do not author logos.
