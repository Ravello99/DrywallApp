# Putting the app on app.vanguarddrywall.ca

When this is done:

- The app is at **https://app.vanguarddrywall.ca**, with a free SSL certificate that renews itself.
- The company website's **Employee login** buttons and estimate form use that address.
- GPS clock-in works in the browser, which needs HTTPS.

It takes two parts: a DNS record in cPanel, then one command on the server.

---

## Part 1: Add the CNAME record in HostPapa's cPanel

HostPapa only manages the DNS for `vanguarddrywall.ca`. The app runs on your separate app server,
the machine where you run `run.py`. A CNAME has to point to a hostname, not an IP address, so first
get a hostname for the app server.

### 1. Get the CNAME target from the app server

Log in to the app server and run:

```bash
cd ~/DrywallApp
python3 run.py update        # gets this new command (and restarts the app as usual)
python3 run.py dns-target
```

It prints the server's IP and one or two hostnames, for example:

```
This server's public IP: 203.0.113.5

Put ONE of these in the CNAME record's target ("Record") field:

  1. vps-1a2b3c.vps.ovh.ca
     your server provider's hostname for this server (best choice)

  2. 203-0-113-5.sslip.io
     free public service that always resolves to 203.0.113.5 (works with any provider)
```

- If it shows a **provider hostname** (option 1), use that one.
- If only the **sslip.io** name appears, use it. It's a free, widely used service that always
  points to the IP written in the name.
- Either way, if the server's IP ever changes, the record needs updating.
- Some providers also show a hostname in their control panel (often called
  "hostname", "reverse DNS" or "PTR"). That works too, as long as it resolves to the server's IP.

### 2. Add the record in cPanel

1. Log in to HostPapa and open **cPanel** for vanguarddrywall.ca.
2. In the **Domains** section, open **Zone Editor**. Don't use the **Subdomains** tool: it would
   send `app` to HostPapa's web server instead of your app server.
3. On the **vanguarddrywall.ca** row, click **+ CNAME Record**. On some versions, click
   **Manage**, then **+ Add Record**, then choose type **CNAME**.
4. Fill it in:

   | Field | Value |
   |---|---|
   | Name | `app` (cPanel fills in `app.vanguarddrywall.ca.`) |
   | TTL | `300` (or the default) |
   | Record / CNAME | the hostname from step 1, e.g. `203-0-113-5.sslip.io` |

5. Click **Add Record**.
6. If a record named `app.vanguarddrywall.ca` already exists (an A or CNAME record), delete it
   first. A name can only have one CNAME, and nothing else alongside it.

### Check that it worked

Wait 5 to 30 minutes, then run this on the server:

```bash
getent hosts app.vanguarddrywall.ca
```

It should show the app server's IP. If it shows nothing or a different IP, wait longer, or check the record.

> **Note:** if your domain's nameservers point somewhere other than HostPapa (for example Cloudflare or your domain registrar), changes in cPanel's Zone Editor have no effect. Add the same record wherever your DNS is actually managed. On Cloudflare, set the record to **DNS only** (grey cloud).

---

## Part 2: Switch the server to the new address

### 1. Open the ports

In the **app server provider's** firewall or security group (not HostPapa), allow incoming **TCP 80 and 443** (443 for HTTPS, 80 so the certificate can be issued). Keep 8000 and 8081 open as well. If the server uses `ufw`, run.py opens 80 and 443 there for you.

### 2. Switch to the domain

On the app server:

```bash
cd ~/DrywallApp
python3 run.py --domain app.vanguarddrywall.ca
```

This command:
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

---

## Another app on the same server (e.g. Vanguard Takeoff)

Caddy on ports 80/443 can serve more than one domain. Other apps put their
site blocks in **`.data/extra-sites.caddy`** (Vanguard Takeoff's
`python3 takeoff.py domain takeoff.vanguarddrywall.ca` writes it for you).
`run.py` adds that file to its Caddy config each time it starts, so after
changing it run:

```bash
python3 run.py update
```

If the extra file is ever invalid, it is left out (with a message) and
`app.vanguarddrywall.ca` keeps working.
