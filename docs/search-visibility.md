# Public search pages

`npm run build` renders the six public marketing pages from the same React components used in the browser. The build never renders a workspace, reads a session, or requests care data. The normal production client still handles login and the app.

The public route definitions in `src/SaasApp.jsx` generate HTML, canonical URLs, metadata, structured data and the built sitemap. Do not add private routes to `publicPages`. Billing result pages and the SPA 404 fallback receive `noindex, follow`. No authentication, billing API or iOS changes are involved.

Run `npm run test:seo` after building. It checks headings, unique titles, canonical URLs, structured data, local screenshot assets, sitemap routes and utility-page noindex tags.

The pre-rendered homepage uses the existing default public pricing. It was checked against live pricing on 7 October 2026 (GBP 4.99/month, 14-day trial). If pricing changes, update those defaults and rebuild alongside the pricing change; the interactive page continues to load current public pricing. Structured data deliberately has no zero-price offer or invented reviews/ratings.

## Google indexing

1. Verify the `https://familytrack.care/` URL-prefix property in Google Search Console. Keep the existing verification tag; additional owners may need their own verification.
2. Submit `https://familytrack.care/sitemap.xml`.
3. Inspect the homepage and each key landing page, run the live test and request indexing if needed.
4. Review Page indexing and Performance reports for exclusions, impressions, clicks and real search queries. Submission does not guarantee indexing or rankings.

## Rollback

Revert the SEO change and rebuild the static website. No database migration or backend rollback is needed.
