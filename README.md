# Texas Wings & Tails

Website and content management system (CMS) for **Texas Wings & Tails**, a companion parrot aviary in Dallas, Texas.

- **Public site:** the homepage, available birds (searchable and filterable), individual bird pages, species pages, a photo gallery with a lightbox, About, FAQ and Contact.
- **Admin panel (`/admin`):** Wasim can manage birds, species, the gallery, homepage text, the About section, FAQs, testimonials, contact details and site settings without touching code.

## Tech stack

| Part | Choice | Why |
|---|---|---|
| Server | Node.js 20.11+ (tested on Node 24), Express 5 | Simple, fast and widely hosted |
| Pages | EJS templates rendered on the server | Fast first paint and good for SEO. The site works without JavaScript. |
| Database | Postgres: **Neon** (free) in production; PGlite (built-in local Postgres) for development | Content survives restarts on free hosting; local development needs no setup |
| Photos | **Cloudflare R2** (free) in production; a local folder for development | Fast worldwide delivery, 10 GB free, no download fees |
| Images | `sharp` | Every upload is resized into WebP files at 480, 960 and 1600 px wide, auto-rotated, and stripped of EXIF/GPS metadata |
| Hosting | **Render** free plan (`render.yaml` included) | Runs the Node server; allows business sites |
| Fonts | Fraunces and DM Sans, served from this site | No third-party font requests |

## Getting started (local)

```bash
npm install
npm run create-admin      # choose a username and a password (at least 10 characters)
npm run dev               # http://localhost:3000, restarts when files change
```

Then open **http://localhost:3000/admin** and log in.

With no `.env` file, everything runs locally: a development database and photo folder are created in `./data`. That data is separate from the live site.

### Preview with demo birds (optional)

```bash
npm run demo:seed    # adds 6 fictional birds named "DEMO – …"
npm run demo:clear   # removes them. Always run this before going live.
```

### Logo

The original logo files are in `assets/brand/` (`logo-mark.png` is the parrot, `logo-full.png` is the parrot with the name). The site uses versions generated from them: the header mark, favicons, the Apple home-screen icon, the photo-placeholder silhouette and the default link-preview image. If the logo changes, replace those two files and run:

```bash
npm run brand
```

## Admin guide (for Wasim)

| Section | What it's for |
|---|---|
| **Dashboard** | Bird counts by status, new messages, and a setup checklist |
| **Birds** | Add, edit, duplicate or delete birds. On the bird list, tap **Available / Coming Soon / Reserved / Sold** to change a bird's status instantly. You can upload many photos at once, drag them to reorder, and tap the star to make a photo the cover. |
| **Species** | Edit each species page: main photo, extra photos, quick facts and information sections. Drag species to change their order. |
| **Gallery** | Upload photos, add captions, set categories, mark photos as featured (shown on the homepage), drag to reorder, and delete. |
| **Messages** | Contact-form messages, with one-tap reply by email or WhatsApp |
| **Homepage** | Main banner photo, headline, the four trust boxes and section headings |
| **About section** | Wasim's photo and story |
| **FAQs** | Write answers and choose which questions to show |
| **Testimonials** | Real customer reviews, with an optional photo and a featured setting |
| **Contact info** | Email, WhatsApp number and location. WhatsApp and email buttons appear on the site only after these are filled in. |
| **Website settings** | Website address, search and link-preview details, social media links, default pickup and shipping text, gallery categories, and whether prices are shown |
| **Your account** | Change the admin password |

Text tips: leave an empty line between paragraphs. Start a line with `- ` to make a bullet list.

## Content that still needs Wasim

The site is built not to make claims Wasim hasn't made. Before launch:

1. **Contact info:** add the WhatsApp number and email address.
2. **Photos:** upload the homepage banner photo, Wasim's photo, species photos and gallery photos. Until then, the site shows illustrated placeholders.
3. **FAQs:** every answer except "What species do you raise?" is blank, and blank FAQs stay hidden. That includes payment, DNA testing, weaning, shipping, visits and what happens after purchase.
4. **Species pages:** the starter text is general reference information about each species (typical size, lifespan and so on). Review it and fill in "Socialization" with how the birds are raised here.
5. **Pickup and shipping:** set the defaults in Website settings. They stay hidden while empty, so leave shipping empty if shipping isn't offered.
6. **Testimonials:** add only real reviews, with the customer's permission. The section stays hidden until one exists.
7. **Website settings:** enter the live website address so search engines get correct links.

## Deploying to Render (free) with Neon and Cloudflare R2

Render's free plan erases the server's disk on every restart, so all content lives in **Neon** and all photos in **Cloudflare R2**. Both are free for a site this size.

### 1. Create the Neon database
1. Sign up at https://neon.tech (free).
2. Create a project named `texas-wings-and-tails`. For the region, pick **AWS US East (Ohio)**, which is the same area as the Render region in `render.yaml`.
3. Click **Connect** and copy the **connection string** (it starts with `postgresql://` and ends with `sslmode=require`).

### 2. Create the R2 bucket
Follow the R2 steps: create a bucket, turn on public access, and create an API token with **Object Read & Write** for that bucket only. You need five values: account ID, Access Key ID, Secret Access Key, bucket name and public URL. The Access Key ID and Secret Access Key are separate from the token value that starts with `cfat_`.

### 3. Test the settings on your computer
Create a file named **`.env`** (not `.env.example`) in the project folder:
```
DATABASE_URL=postgresql://...your Neon connection string...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
R2_PUBLIC_URL=https://pub-....r2.dev
```
Then run:
```bash
npm run check          # connects to Neon, creates the tables, uploads + deletes a test file in R2
npm run create-admin   # creates Wasim's login in the live database
```
Render's free plan has no command line, so the admin account is created from your computer. Run `npm run create-admin` again later to reset the password.

While `.env` contains these values, `npm run dev` on your computer works on the **live** content. To go back to a separate local test database, rename `.env` (for example to `.env.live`).

### 4. Put the code on GitHub
Create a **private** repository and push this project. `.env` and `data/` are excluded by `.gitignore`, so secrets and local data are never uploaded.

### 5. Create the Render service
1. Sign up at https://render.com with your GitHub account.
2. Click **New → Blueprint**, choose the repository, and Render will read `render.yaml`.
3. Fill in the six values it asks for (the same ones as in `.env`), then click **Apply**.
4. When the deploy finishes, open the `https://….onrender.com` address, go to `/admin`, log in, and enter the address under **Website settings → Website address**.

The deploy log should show `Database: Postgres` and `Photos: Cloudflare R2`. If it shows a WARNING instead, a value is missing or wrong.

### 6. Custom domain (optional)
Render → your service → **Settings → Custom Domains**. Add the domain, then create the DNS record Render shows you at your domain registrar. HTTPS is set up automatically. Update **Website address** in the admin panel to match.

### Things to know about the free plan
- **Sleeping:** after about 15 minutes without visitors, Render pauses the site, and the next visitor waits up to about a minute while it wakes up. To avoid this, a free monitor such as UptimeRobot can visit `https://your-site/healthz` every 5 minutes. Check Render's current free-plan terms first.
- **Updates:** every push to GitHub redeploys automatically.
- **Backups:** Neon keeps a short restore history on the free plan. For extra safety, export the database now and then from the Neon dashboard. Photos in R2 aren't affected by deploys.
- **Email alerts** (optional `SMTP_*` settings): Render's free plan may block outgoing email ports. If alerts don't arrive, messages are still saved under **Messages** in the admin panel.

## Running on your own server instead
Any host with Node 20+ works. Set the same environment variables plus `NODE_ENV=production` and `TRUST_PROXY=1` (when behind a proxy), run `npm ci --omit=dev && npm start`, and serve the site over HTTPS.

## Security

- No public sign-up. Admin accounts are created only from the command line.
- Passwords are hashed with bcrypt (cost 12). Sessions use random IDs stored server-side, in `HttpOnly`, `SameSite=Strict` cookies (also `Secure` in production) that expire after 12 hours of inactivity.
- Every admin form checks a CSRF token.
- After 5 failed logins for one username, or 20 from one IP address, login is locked for 15 minutes.
- Changing the password signs out all other sessions.
- Strict Content-Security-Policy and Helmet security headers are applied.
- Admin pages send `noindex` headers, and `robots.txt` disallows `/admin`. The public site doesn't link to the admin panel.
- Uploads must be images, up to 20 MB each. Every upload is re-encoded, which removes hidden data and GPS location.
- The contact form has a honeypot field, a signed minimum-time check, a per-IP rate limit, a link-stuffing filter, and server-side validation.

## SEO and performance

- Every page has its own title, meta description, canonical URL, and Open Graph/Twitter tags.
- Schema.org markup: `LocalBusiness` (Dallas, TX, with no street address), `Product`/`Offer` for each bird, `FAQPage`, and `BreadcrumbList`.
- `sitemap.xml` and `robots.txt` are generated automatically.
- Images are responsive (`srcset`/`sizes`), lazy-loaded below the fold, and sized to avoid layout shift. The main photo is preloaded with high priority.
- Gzip compression is enabled. Uploaded photos are served from Cloudflare R2 and cached long-term, because each file gets a unique, unchanging URL.

## Project structure

```
server.js              app setup, security headers, static files, /healthz
render.yaml            Render deployment blueprint
src/db.js              Postgres connection (Neon or local PGlite), schema, first-run seeding
src/storage.js         photo storage (Cloudflare R2 or local folder)
src/seed-content.js    starter species info + FAQ questions
src/settings.js        editable site settings and admin form definitions
src/images.js          upload processing + responsive <img> helper
src/auth.js            login, sessions, CSRF, anti-spam tokens
src/models.js          queries for birds, species, gallery, testimonials, FAQs
src/routes/public.js   public pages, contact form, sitemap
src/routes/admin.js    admin panel
views/                 page templates (views/admin/ = admin panel)
public/                CSS, JS, logo files
assets/brand/          original logo artwork
scripts/               create-admin, check (tests .env settings), demo data, brand (logo files)
```
