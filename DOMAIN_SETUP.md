# Putting the app on app.vanguarddrywall.ca

When this is done:

- The app is at **https://app.vanguarddrywall.ca**, with a free SSL certificate that renews itself.
- The company website's **Employee login** buttons and estimate form use that address.
- GPS clock-in works in the browser, which needs HTTPS.

It takes two parts: a DNS record in cPanel, then one command on the server.

---

## Part 1: Add the DNS record in cPanel

### Which record: A or CNAME?

A **CNAME** has to point to another *name*, not to an IP address.

- **Your server has only an IP address** (for example `203.0.113.5`). Use an **A record** instead. It does the same job for an IP. This is the usual case for a VPS.
- **Your hosting provider gave the server a hostname** (for example `vps-12345.yourhost.com`). You can use a **CNAME** pointing to that hostname.

To find the server's IP, run this on the server:

```bash
curl -4 ifconfig.me
```

### Steps in cPanel

1. Log in to cPanel for **vanguarddrywall.ca**.
2. In the **Domains** section, open **Zone Editor**.
   - Don't use the **Subdomains** tool for this. It would point `app` at your cPanel web host instead of your app server.
3. On the **vanguarddrywall.ca** row, click **+ A Record** or **+ CNAME Record**. On some cPanel versions, click **Manage**, then **+ Add Record**, then choose the type.
4. Fill it in:

   | Field | A record (server has an IP) | CNAME record (server has a hostname) |
   |---|---|---|
   | Name | `app` (cPanel fills in `app.vanguarddrywall.ca.`) | `app` |
   | TTL | `300` (or leave the default) | `300` |
   | Record / Address | your server's IP, e.g. `203.0.113.5` | the server's hostname, e.g. `vps-12345.yourhost.com` |

5. Click **Add Record** (or **Save Record**).
6. If a record named `app.vanguarddrywall.ca` already exists, edit it or delete it, so there is only one.

### Check that it worked

Wait 5 to 30 minutes, then run this on the server:

```bash
getent hosts app.vanguarddrywall.ca
```

It should show your server's IP. If it shows nothing or a different IP, wait longer, or check the record.

> **Note:** if your domain's nameservers point somewhere other than your cPanel host (for example Cloudflare or your domain registrar), changes in cPanel's Zone Editor have no effect. Add the same record wherever your DNS is actually managed. On Cloudflare, set the record to **DNS only** (grey cloud).

---

## Part 2: Switch the server to the new address

### 1. Open the ports

In your server provider's firewall or security group, allow incoming **TCP 80 and 443** (443 for HTTPS, 80 so the certificate can be issued). Keep 8000 and 8081 open as well. If the server uses `ufw`, run.py opens 80 and 443 there for you.

### 2. Run the update

On the server:

```bash
cd ~/DrywallApp
python3 run.py update --domain app.vanguarddrywall.ca
```

This command:
- Gets the latest code.
- Checks that `app.vanguarddrywall.ca` really points at this server. If it doesn't, it stops and changes nothing.
- Installs Caddy into the app folder. Caddy obtains the SSL certificate from Let's Encrypt and renews it automatically.
- Rebuilds the web app to use `https://app.vanguarddrywall.ca`, then restarts everything.

The domain is remembered, so later updates are just `python3 run.py update`.

### 3. Test

- Open **https://app.vanguarddrywall.ca** and sign in. The certificate can take up to a minute on first start.
- Run `python3 run.py status` to see all the addresses.
- Phones using **Expo Go** still open `exp://<server IP>:8081` as before. The app now talks to the server over HTTPS.

### If something goes wrong

| What you see | What to do |
|---|---|
| "doesn't resolve yet" or "points to ... but this server is ..." | The DNS record isn't live or is wrong. Recheck Part 1, wait, and run the command again. |
| "Port 80 is already used by another program" | Something like apache2 or nginx is running. Stop it with `sudo systemctl disable --now apache2` (or `nginx`), then run again. |
| The browser says the certificate isn't valid | Look at `.logs/caddy.log`. Usually port 80 or 443 is blocked in the provider's firewall. |
| You need to go back to the old address | `python3 run.py --domain off` |

The old address `http://<server IP>:8000` keeps working, so nobody is locked out while the switch happens.

---

## The company website

`website/index.html` is already set to send **Employee login** and estimate requests to `https://app.vanguarddrywall.ca`.

To host the website at `vanguarddrywall.ca` on cPanel:
1. Open **File Manager** and go to `public_html`.
2. Upload `index.html` and the `assets` folder from the repo's `website` folder.
