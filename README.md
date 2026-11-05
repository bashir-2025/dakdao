# ডাকদাও (Dakdao)

A Bangla "outbid" site. Whoever pays the most gets their message in the top spot. Payment is by manual bank transfer, and an admin checks each payment.

## Run locally

Needs **Node.js 20 or newer**.

```bash
npm install
cp .env.example .env      # then set a strong ADMIN_PASSWORD
node --env-file=.env server.js
```

Open http://localhost:3000. The admin panel is at http://localhost:3000/admin.

## Configure

- **`config.json`**: your bank details, the starting price and the minimum step between bids.
- **`.env`**: `ADMIN_PASSWORD` (required, at least 8 characters), `PORT`, `COOKIE_SECURE=1` when the site runs on HTTPS, and `TRUST_PROXY=1` when it runs behind a proxy or hosting platform.

## How it works

1. A visitor enters a name, a message and an amount. The server checks that the amount beats the current top bid and returns a reference code (for example `DDAB12CD`).
2. The visitor transfers the money with that reference code and submits the transaction ID. Each transaction ID can be used only once.
3. The admin compares the ID with the bank statement and approves or rejects the bid. The highest approved bid takes the top spot.

Data is stored in a local `data.db` file, or in Turso when `TURSO_DATABASE_URL` is set. Unpaid drafts older than 24 hours are deleted automatically.

## Deploy for free (Render + Turso)

**Render** runs the server for free. Its disk is wiped on every restart, so the bids are stored in **Turso**, a free hosted SQLite database.

Free-plan limits: Render puts the site to sleep after 15 minutes with no visitors, and the first visit after that takes about a minute to load. Turso's free plan includes 5 GB of storage.

### 1. Create the database on Turso
1. Sign up at https://turso.tech (GitHub login works).
2. Create a database, for example `dakdao`, in the region closest to Bangladesh (Mumbai or Singapore).
3. Copy the database URL (starts with `libsql://`).
4. Create a token for the database and copy it.

### 2. Put the code on GitHub
1. Create a new **private** repository at https://github.com/new, for example `dakdao`. Don't add a README.
2. Push the code:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/dakdao.git
   git push -u origin main
   ```

### 3. Deploy on Render
1. Sign up at https://render.com with GitHub.
2. Click **New → Blueprint**, pick the `dakdao` repository and confirm. Render reads `render.yaml`.
3. Render asks for three secret values:
   - `ADMIN_PASSWORD`: a strong password, at least 8 characters
   - `TURSO_DATABASE_URL`: the URL from step 1
   - `TURSO_AUTH_TOKEN`: the token from step 1
4. Click **Apply**. After a few minutes the site is live at `https://dakdao.onrender.com` (or a similar address). The admin panel is at `/admin`.

When you change something, commit and `git push`; Render redeploys automatically.

### Optional: keep the site awake
To avoid the one-minute wake-up, a free uptime monitor (for example UptimeRobot) can request `https://YOUR-SITE.onrender.com/api/health` every 10 minutes. That uses about 730 of Render's 750 free hours a month, which is enough for one site.
