# Cloudflare setup

This project now uses Cloudflare Worker + D1 + R2. The product catalog intentionally starts empty.

1. Create a D1 database named \`crocheted-dream\`.
2. Put its database ID into \`wrangler.toml\`.
3. Create an R2 bucket named \`crocheted-dream-product-images\`.
4. Run \`npm install\`.
5. Run \`npm run db:remote\`.
6. Add Worker secrets:
   - \`ADMIN_USERNAME\`
   - \`ADMIN_PASSWORD\`
   - \`ADMIN_SESSION_SECRET\` (use a long random value)
7. Deploy with \`npm run deploy\`.
8. Open \`/admin/\` and create the customer's new products.

There is no Supabase migration/import path. Uploaded admin images are converted in-browser to WebP before being stored in R2.
