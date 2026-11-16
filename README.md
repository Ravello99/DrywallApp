# Drywall Company Management App

Mobile app (Expo / React Native) with a FastAPI backend and MongoDB, for running a
commercial drywall, steel stud framing, insulation and acoustics company.
Built on the OakdaleApp1 codebase and being extended role by role:
estimators/coordinators, project managers, foremen and employees.

## Run it on the server (Ubuntu 20.04+, one command)

Log in to the server as your normal user (not root), then:

```bash
git clone https://github.com/Ravello99/DrywallApp.git
cd DrywallApp
python3 run.py
```

No sudo and no prompts. Ubuntu 20.04's built-in Python 3.8 is enough to run the
launcher. The first run downloads what the app needs into this folder (Python 3.12,
Node.js 22.14, MongoDB) and takes about 10 minutes. After that it:

- starts the database, backend and app **in the background** (closing your SSH session is fine),
- **restarts** any part that crashes,
- **starts again automatically when the server reboots**,
- prints the addresses, the **manager login** (also saved in `LOGIN_DETAILS.txt`) and a QR code.

| Command | What it does |
|---|---|
| `python3 run.py` | Set up / update and (re)start everything |
| `python3 run.py status` | Show whether it's running, plus the addresses and login |
| `python3 run.py logs` | Watch the logs live (Ctrl+C to stop watching) |
| `python3 run.py update` | Get the latest version from GitHub and restart (use this for every update) |
| `python3 run.py stop` | Stop everything and turn off start-on-reboot |
| `python3 run.py --host app.example.com` | Use a domain name (or a specific IP) instead of the detected public IP |
| `python3 run.py --no-expo` | Run only the web app + API (no phone dev server) |

To update, run `python3 run.py update`: it pulls the latest code, reinstalls only what changed and
rebuilds the web app.

### How people reach it

| Who | Where |
|---|---|
| Office (any browser) | `http://<server>:8000` |
| Phones (testing) | Install **Expo Go**, scan the QR code or enter `exp://<server>:8081` |
| API explorer | `http://<server>:8000/docs` |

**Open ports 8000 and 8081** on the server. On a cloud server (AWS, DigitalOcean, Azure…)
that means the provider's firewall / security group. If `ufw` is active on the server, run
`sudo ufw allow 8000,8081/tcp`.

### Good to know

- **Web clock-in needs HTTPS.** Browsers only give GPS to secure sites, so clocking in through the
  web app needs a domain name with HTTPS (planned). Clocking in through the phone app works now.
- **Expo Go is for testing.** The app is on **Expo SDK 58**, the version the current Expo Go in the
  App Store / Play Store opens. For the crew's phones long-term we'll build a proper installable app.
- **RAM:** building the web app needs about 2 GB. On a 1 GB server, add swap first.
- **MongoDB** listens only on the server itself (127.0.0.1), never on the internet. Data lives in
  `.data/db`. On CPUs without AVX the launcher automatically uses MongoDB 4.4.
- If MongoDB complains about a missing library, the error tells you the one `apt-get` command to run.

### Where things live (none of these are committed to git)

| Path | What it is |
|---|---|
| `backend/.env` | Database address, random secret key, first admin login |
| `frontend/.env` | Server address the app uses |
| `.data/` | Database files and launcher state |
| `.logs/` | `launcher.log`, `backend.log`, `mongod.log`, `expo.log` |
| `.tools/` | Downloaded Python, Node.js and MongoDB |

## What's in the app

**Office (Admin, Project Manager, Project Coordinator, Estimator)**

| Tab | What it does |
|---|---|
| Dashboard | Job sites at a glance (men on site, progress, hours vs budget, flags), shut-down sites, flagged clock-ins, receivables, notifications |
| Projects | Every job; open one for **Overview** (money, materials vs billing, labour by scope, crew on site), **Tasks** (apply a scope workflow, hour budgets, progress), **Materials** (approve/release), **Crew** (assign, approve manpower), **RFIs**, **Change Orders**, **Draws** |
| Bids | Bid log sorted Multi-Family / Commercial Fit-Out / Institutional, weekly submitted chart, win rate, follow-up reminders, paste-in invites, bid inbox, won bid → project |
| Approvals | Material and manpower requests from foremen, flagged clock-ins (PM / Admin) |
| Team | Employees (role, trade, level, pay rate, emergency contact), sites (GPS, radius, shut down / reopen) |
| More | Timesheets & Excel export, safety documents, forms, all tasks, announcements |

**Field (Foreman, Employee)**

| Tab | What it does |
|---|---|
| Home | Hours this week, today's site, safety-document warnings; foremen also see each site's crew, progress and open tasks |
| Clock | GPS-checked clock in/out, pick the task you're working on |
| Calendar | Which site you're on each day, tasks due |
| Tasks | Employees: their tasks. Foremen: every task on their sites, update progress |
| Requests | Foremen: request materials, request or release crew by trade |
| More | Forms (foremen can send forms to crew), RFIs and crew safety (foremen), hours history, safety docs, profile |

**Automatic alerts** (checked hourly, sent once each): safety documents (2-week notice to the
employee, 1-week and expired warnings to the foreman), tasks at 90% / over their hour budget,
materials released more than 10 points ahead of billing, bid follow-ups and due dates, progress
draws unpaid after 30/60/90 days.

### Connecting the bid inbox

Add to `backend/.env` on the server, then run `python3 run.py` again:

```
BID_INBOX_HOST=imap.gmail.com
BID_INBOX_USER=bids@yourcompany.com
BID_INBOX_PASSWORD=your-16-character-app-password
```

For Gmail / Google Workspace: turn on IMAP in Gmail settings and create an **App Password**
(Google Account → Security → 2-Step Verification → App passwords). Microsoft 365 usually blocks
password IMAP; forward bid invites to a Gmail address, or use **Paste invite email** in the app.
The inbox is checked every 10 minutes (`BID_INBOX_POLL_MINUTES`), messages stay unread, and each
email is imported only once.

### Invoices (progress draws)

Each progress draw is an invoice. While it's a draft you can edit it and **Preview invoice**;
**Send invoice** dates it, sets the due date and freezes it (bill-to, contract summary, amounts).
**View invoice** opens a printable page: use **Print or save as PDF** and email the PDF to the GC.
Every draw keeps a history (created, edited, sent, each payment). Company details on the invoice
come from `backend/.env` (restart with `python3 run.py` after changing them):

```
COMPANY_NAME=VanGuard Drywall & Acoustics
COMPANY_ADDRESS=3 - 55 Oakdale Ave\nSt. Catharines, ON
COMPANY_PHONE=289-866-7222
COMPANY_EMAIL=accounting@yourcompany.ca
COMPANY_GST_NUMBER=123456789 RT0001
PAYMENT_TERMS_DAYS=30
```

### Accounting

**More → Accounting** (admin and project coordinators) has three parts:

- **Labour & payroll:** each pay week's gross labour payout, by job and by employee, with regular
  and overtime hours. Overtime is worked out per person per week and charged to the job it was
  worked on. Warnings for missing pay rates, people still clocked in and flagged clock-ins.
- **Progress draws:** outstanding, overdue, aging, holdback by job, drafts not sent, and what was
  sent and paid this week.
- **Downloads:** employee hours for any period, for everyone, one job or one employee, as one Excel
  workbook (summaries plus a tab per job and per employee) or a ZIP with a file per job and per
  employee; and the invoice register.

Settings in `backend/.env` (defaults shown):

```
COMPANY_TIMEZONE=America/Toronto
PAY_WEEK_START=0            # 0 = Monday ... 6 = Sunday
OVERTIME_WEEKLY_HOURS=44    # Ontario ESA
OVERTIME_MULTIPLIER=1.5
```

### Domain and HTTPS

To serve the app at https://app.vanguarddrywall.ca, follow [DOMAIN_SETUP.md](DOMAIN_SETUP.md):
add the DNS record in cPanel, then run `python3 run.py update --domain app.vanguarddrywall.ca`.

## Tests

```bash
python3 backend/tests/test_logic.py            # business rules (money, budgets, bids...)
python3 backend/tests/offline/flow_test.py     # every feature end to end + permissions, no server needed
```

## Project layout

```
backend/   FastAPI API (server.py), requirements.txt
frontend/  Expo app: app/manager/*, app/worker/* screens, src/services/* API clients
run.py     one-command launcher
```

## Roadmap

- ✅ **Foundation:** clean repo, no default login or hardcoded secret, server launcher, VanGuard
  rebrand, six roles with site scoping, server-side GPS radius, job shutdown, employee profiles,
  API split into core / logic / feature modules.
- ✅ **Field operations:** scope workflows, hour budgets and flags, safety alerts, foreman forms,
  manpower requests, dashboards, calendar, hours.
- ✅ **Money and materials:** progress draws with holdback and tax, material requests and releases
  vs billing, change orders, RFIs, job costing and margins.
- ✅ **Bids:** bid inbox, paste-in and manual bids, automatic sorting, bid log, win rates, follow-ups.
- **Next:** HTTPS with a domain name (needed for web clock-in), phone push notifications,
  installable phone app (instead of Expo Go), file storage outside the database for large
  drawings, PDF progress-draw invoices.
