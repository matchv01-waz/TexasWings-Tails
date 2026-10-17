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
| Hosting | **Netlify** (`netlify.toml` included): the app runs as one serverless function and static files come from the CDN. A `render.yaml` for Render is also included. | No server to manage; automatic deploys from GitHub |
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

## Deploying to Netlify with Neon and Cloudflare R2

On Netlify the pages, admin panel and contact form run in one serverless function (`netlify/functions/server.js`), and CSS, JavaScript, the logo and fonts are served from Netlify's CDN. A function has no permanent disk, so all content lives in **Neon** and all photos in **Cloudflare R2**. Both are free for a site this size. `netlify.toml` holds the build settings.

### 1. Create the Neon database
1. Sign up at https://neon.tech (free).
2. Create a project named `texas-wings-and-tails`. For the region, pick **AWS US East (Ohio)**, close to where Netlify runs functions by default.
3. Click **Connect** and copy the **connection string** (it starts with `postgresql://` and ends with `sslmode=require`). Use the **pooled** connection string; it handles many short-lived connections well.

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
Netlify has no command line for the site, so the admin account is created from your computer. Run `npm run create-admin` again later to reset the password.

While `.env` contains these values, `npm run dev` on your computer works on the **live** content. To go back to a separate local test database, rename `.env` (for example to `.env.live`).

### 4. Put the code on GitHub
Push this project to a GitHub repository. `.env` and `data/` are excluded by `.gitignore`, so secrets and local data are never uploaded.

### 5. Create the Netlify site
1. Sign up at https://netlify.com with your GitHub account.
2. **Add new project → Import an existing project → GitHub**, and choose the repository. Netlify reads `netlify.toml`, so leave the build settings as they are (build command `npm run build:netlify`, publish directory `dist`).
3. Before the first deploy (or afterwards, under **Project configuration → Environment variables**), add:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` | the same values as in `.env` |
   | `SESSION_SECRET` | a long random text, for example from `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

   Mark the secret values as **secret**. Environment variables only reach the site after a deploy, so after adding or changing one, run **Deploys → Trigger deploy**.
4. When the deploy finishes, open the `https://….netlify.app` address, go to `/admin`, log in, and enter the address under **Website settings → Website address**.

If a page says "The website is starting up or is not configured yet", `DATABASE_URL` is missing or wrong. Check **Logs → Functions** in Netlify for the exact message.

### 6. Custom domain (optional)
Netlify → your site → **Domain management → Add a domain**. Follow the DNS steps Netlify shows. HTTPS is set up automatically. Update **Website address** in the admin panel to match.

### How the site works on Netlify
- **Photo uploads:** Netlify accepts at most about 6 MB per request and 10 seconds per request. The admin panel therefore shrinks photos in the browser (to 2048 px, more than the 1600 px the site displays) and sends large selections a few photos at a time, with progress shown on the button. This needs JavaScript in the admin panel, which every modern browser has.
- **Several copies:** Netlify can run several copies of the function at once. Sessions, login lockouts and contact-form limits are stored in the database, so they work across copies. Settings and menus are cached for at most 10 seconds, so an edit can take up to 10 seconds to appear on every public page.
- **First visit after a quiet period** can take a second or two longer while the function and Neon wake up.
- **Updates:** every push to GitHub redeploys automatically.
- **Backups:** Neon keeps a short restore history on the free plan. For extra safety, export the database now and then from the Neon dashboard. Photos in R2 aren't affected by deploys.
- **Email alerts** (optional `SMTP_*` settings) work as long as the SMTP provider is reachable. If alerts don't arrive, messages are still saved under **Messages** in the admin panel.

## Deploying to Render instead
`render.yaml` is a ready Render blueprint: **New → Blueprint**, choose the repository, and fill in the same six values (Render generates `SESSION_SECRET` itself). On Render's free plan the site sleeps after about 15 minutes without visitors, and the next visitor waits up to about a minute.

## Running on your own server instead
Any host with Node 20+ works. Set the same environment variables plus `NODE_ENV=production` and `TRUST_PROXY=1` (when behind a proxy), run `npm ci --omit=dev && npm start`, and serve the site over HTTPS.

## Security

- No public sign-up. Admin accounts are created only from the command line.
- Passwords are hashed with bcrypt (cost 12). Sessions use random IDs stored server-side, in `HttpOnly`, `SameSite=Strict` cookies (also `Secure` in production) that expire after 12 hours of inactivity.
- Every admin form checks a CSRF token.
- After 5 failed logins for one username, or 20 from one IP address, within 15 minutes, login is locked for 15 minutes. Attempts are counted in the database, so this holds on serverless hosting too.
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
- Responses are compressed (by Netlify's CDN, or by the app on other hosts). Uploaded photos are served from Cloudflare R2 and cached long-term, because each file gets a unique, unchanging URL.

## Project structure

```
server.js              app setup, security headers, static files, /healthz
netlify.toml           Netlify build, function and CDN settings
netlify/functions/     the Netlify function that runs the app
render.yaml            Render deployment blueprint (alternative)
src/db.js              Postgres connection (Neon or local PGlite), schema, first-run seeding
src/storage.js         photo storage (Cloudflare R2 or local folder)
src/seed-content.js    starter species info + FAQ questions
src/settings.js        editable site settings and admin form definitions
src/images.js          upload processing + responsive <img> helper
src/auth.js            login, sessions, CSRF, anti-spam tokens
src/throttle.js        login lockout + contact-form rate limit (stored in the database)
src/models.js          queries for birds, species, gallery, testimonials, FAQs
src/routes/public.js   public pages, contact form, sitemap
src/routes/admin.js    admin panel
views/                 page templates (views/admin/ = admin panel)
public/                CSS, JS, logo files
assets/brand/          original logo artwork
scripts/               create-admin, check (tests .env settings), demo data, brand (logo files), build-netlify
```
