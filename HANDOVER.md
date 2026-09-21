# Handover — running Upforce Hub on a Hostinger VPS

Everything needed to take this app over and run it on your own server. Read
`README.md` first for what the app is; this file is about owning and hosting it.

**Hostinger shared and Cloud plans cannot run this app.** They serve PHP; Hub
is a Next.js app that needs a Node process running on every request, for
auth middleware, server actions and server rendering. There is no static-export
fallback. A **VPS** is required — the steps below assume Ubuntu 22.04 or 24.04.

---

## 1. What you are taking over

| Piece | Where it lives | What happens |
| --- | --- | --- |
| Code | this GitHub repo | transferred to you |
| Database, auth, all data | a Supabase project | transferred to your Supabase org |
| Hosting | currently Vercel | replaced by your VPS, then Vercel is deleted |
| Domain | Namecheap | pushed to your Namecheap account, then pointed at your VPS |

The Supabase project moves as-is: same URL, same keys, same data. Nothing in
the database needs rebuilding.

---

## 2. Before you start

- A Supabase account with an organisation to receive the project.
- A GitHub account to receive the repo.
- A Hostinger VPS — **2 GB RAM minimum**. `npm run build` can run out of
  memory on 1 GB; if that is all you have, add swap (step 4.2).
- Access to the domain's DNS settings.

---

## 3. Transfers (done by the current owner)

In this order:

1. **Supabase project → your org.** Keeps its URL and keys, so the live site
   never notices. Your org needs room for it — free-tier orgs cap active
   projects.
2. **GitHub repo → your account.** Auto-deploys to Vercel stop at this point.
   That is expected; the live site keeps serving its last build until your VPS
   takes over.
3. **Domain → you.** The domain is registered at **Namecheap**. It moves by a
   Namecheap account-to-account push, so you need a (free) Namecheap account
   to receive it — the previous owner needs your Namecheap username and the
   email on it.

   A push is instant, free, and not subject to the 60-day transfer lock,
   because the domain never leaves Namecheap. Moving it to Hostinger instead
   would be a registrar transfer: up to a week, usually a year's renewal fee,
   and blocked for 60 days after registration. If you want it at Hostinger
   eventually, push it to your Namecheap account now and transfer it later.

   **Leave the DNS records exactly as they are during the transfer** — they
   still point at Vercel, which is what keeps the site up. You change them in
   step 4.9, once your VPS is ready. Changing them early takes the site down
   until the VPS is serving.

You will then need two values from **Supabase → Project Settings → API**:

- **Project URL** — `https://xxxx.supabase.co`
- **anon / publishable key**

---

## 4. Server setup

Everything in this section runs on the VPS, over SSH.

### 4.1 Base packages and Node

Next.js 14 needs Node 18.17 or newer. Install Node 20 LTS from NodeSource:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

### 4.2 Swap (only if the VPS has under 2 GB RAM)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 4.3 Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Port 3000 is deliberately **not** opened. The app listens on localhost only and
is reached through nginx.

### 4.4 A user to run the app

Running a web app as root means any flaw in it has the whole server.

```bash
sudo adduser --system --group --home /srv/upforce-hub upforce
sudo git clone https://github.com/<your-account>/upforce-hub.git /srv/upforce-hub
sudo chown -R upforce:upforce /srv/upforce-hub
```

For a private repo, clone with a GitHub personal access token or a deploy key.

### 4.5 Environment

```bash
sudo -u upforce nano /srv/upforce-hub/.env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

**These are baked in at build time.** Any variable starting `NEXT_PUBLIC_` is
written into the compiled app during `npm run build`. Change one later and
nothing happens until you rebuild. This is the most common way a deploy
"ignores" a setting.

Do not put the service-role key here — nothing reads it, and it bypasses all
database security.

### 4.6 Build

```bash
cd /srv/upforce-hub
sudo -u upforce npm ci
sudo -u upforce npm run build
```

### 4.7 Run it as a service

systemd keeps the app running, restarts it if it crashes, and starts it again
after a reboot.

```bash
sudo nano /etc/systemd/system/upforce-hub.service
```

```ini
[Unit]
Description=Upforce Hub
After=network.target

[Service]
Type=simple
User=upforce
WorkingDirectory=/srv/upforce-hub
Environment=NODE_ENV=production
ExecStart=/usr/bin/npx next start -H 127.0.0.1 -p 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now upforce-hub
sudo systemctl status upforce-hub
curl -I http://127.0.0.1:3000/sign-in
```

`-H 127.0.0.1` binds to localhost only. The `curl` should return `200`.

### 4.8 nginx

```bash
sudo nano /etc/nginx/sites-available/upforce-hub
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
```

**Do not drop the `Host` and `X-Forwarded-Host` lines.** Next.js checks that
server actions come from the same host they are served on. Without these
headers every save in the app — logging a touch, moving a stage, editing a
tag — fails with *Invalid Server Actions request*, while pages still load
fine. It looks like a broken app; it is a proxy setting.

```bash
sudo ln -s /etc/nginx/sites-available/upforce-hub /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 4.9 Point the domain

Only once 4.7 and 4.8 are working — this is the moment traffic moves from
Vercel to your server.

In **Namecheap → Domain List → Manage → Advanced DNS**, set an **A record**
for the domain to the VPS's IP address, replacing the Vercel records. If you use `www`, add a CNAME for it to the apex. Wait for it to
resolve before the next step:

```bash
dig +short your-domain.com
```

### 4.10 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot rewrites the nginx config for HTTPS and installs automatic renewal.
Sign-in needs HTTPS — Supabase's session cookies are secure-only in production.

---

## 5. Point Supabase at the new address

**Supabase → Authentication → URL Configuration:**

- **Site URL** — `https://your-domain.com`
- **Redirect URLs** — add `https://your-domain.com/auth/callback`

Skip this and sign-in works but password-reset links send people to the wrong
place. If the domain did not change, check it anyway.

---

## 6. Check it end to end

1. Sign in at `https://your-domain.com`.
2. Add a test lead. Confirm it lands on Today with a scheduled touch.
3. Open it and log an Email. Confirm the ladder advances.
4. Click **Undo** in Touch history. Confirm the ladder steps back.
5. Delete the test lead from the Danger zone at the bottom of the drawer.

Step 3 is the one that proves the nginx headers are right.

---

## 7. Retire Vercel

Once the VPS is serving the domain and step 6 passes, the **previous owner
deletes the Vercel project**. Until then two copies of the app are live
against one database — harmless for a day, confusing for longer.

---

## 8. After the handover

**Rotate the Supabase service-role key** (Project Settings → API). It bypasses
all database security and has been on the previous owner's machine.

**The admin account.** `admin@upforcehub.com` is the only user. Take over its
password or create your own account and delete it. There is no public signup:
add people in **Supabase → Authentication → Users** with *Auto Confirm User*
ticked.

**The monthly close.** A scheduled database job snapshots revenue at 00:05 UTC
on the 1st. It moves with the Supabase project. To confirm it is running, in
the Supabase SQL Editor:

```sql
select status, start_time from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'upforce-close-month')
order by start_time desc limit 5;
```

---

## Deploying a change

On the VPS:

```bash
cd /srv/upforce-hub
sudo -u upforce git pull
sudo -u upforce npm ci
sudo -u upforce npm run build
sudo systemctl restart upforce-hub
```

The build runs while the old version keeps serving, so there is only a few
seconds of downtime at the restart. If a build fails, the restart never
happens and the old version keeps running.

Logs, when something is wrong:

```bash
sudo journalctl -u upforce-hub -n 100 --no-pager
```

---

## Things that will bite you

- **`NEXT_PUBLIC_*` changes need a rebuild**, not just a restart.
- **Missing proxy headers** break every save while pages still load — see 4.8.
- **Out of memory during build** shows as the build being killed with no clear
  error. Add swap.
- **`supabase/demo_data.sql` is sample data.** Sixteen fictional leads, kept
  outside `migrations/` on purpose. Never run it against the real project.
- **Do not drop or recreate `stage_events`.** It is the log of every stage
  change and cannot be rebuilt — it only knows what happened after it existed.
- **Database changes go in the Supabase SQL Editor**, in the browser. Not the
  server's terminal.
