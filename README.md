# ডাকদাও (Dakdao)

A Bangla "outbid" site. Whoever pays the most gets their message in the top spot. Payment is by manual bank transfer, and an admin checks each payment.

## Run locally

Needs **Node.js 22.5 or newer**. There are no npm packages to install.

```bash
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

All data is stored in `data.db` (SQLite). Back up that file. Unpaid drafts older than 24 hours are deleted automatically.

## Deploy

Use any host that runs a long-lived Node process and has a persistent disk, such as a VPS, Railway or Render with a disk attached. Serverless platforms like Vercel won't work, because SQLite needs a disk that persists. Put the site behind HTTPS and set `COOKIE_SECURE=1` and `TRUST_PROXY=1`.
