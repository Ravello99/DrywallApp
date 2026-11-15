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
Node.js 22, MongoDB) and takes about 10 minutes. After that it:

- starts the database, backend and app **in the background** (closing your SSH session is fine),
- **restarts** any part that crashes,
- **starts again automatically when the server reboots**,
- prints the addresses, the **manager login** (also saved in `LOGIN_DETAILS.txt`) and a QR code.

| Command | What it does |
|---|---|
| `python3 run.py` | Set up / update and (re)start everything |
| `python3 run.py status` | Show whether it's running, plus the addresses and login |
| `python3 run.py logs` | Watch the logs live (Ctrl+C to stop watching) |
| `python3 run.py stop` | Stop everything and turn off start-on-reboot |
| `python3 run.py --host app.example.com` | Use a domain name (or a specific IP) instead of the detected public IP |
| `python3 run.py --no-expo` | Run only the web app + API (no phone dev server) |

After `git pull`, run `python3 run.py` again: it reinstalls only what changed and rebuilds the web app.

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
- **Expo Go is for testing.** For the crew's phones long-term we'll build a proper installable app.
  If Expo Go says the project's SDK is unsupported, the app needs an SDK upgrade (next on the list).
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

## Project layout

```
backend/   FastAPI API (server.py), requirements.txt
frontend/  Expo app: app/manager/*, app/worker/* screens, src/services/* API clients
run.py     one-command launcher
```

## Roadmap

- **Phase 0 – foundation:** ✅ clean repo, ✅ no default login or hardcoded secret, ✅ CORS config,
  ✅ server launcher; next: role/permission model with project scoping, split API into modules,
  Site → Project, file storage outside the database.
- **Phase 1 – field operations:** employee profiles (pay, specialty, certs), server-side GPS radius
  and job shutdown, scope workflows and hour budgets with over-budget flags, safety expiry alerts
  (2 weeks employee / 1 week + expired foreman), foreman forms, manpower requests, dashboards.
- **Phase 2 – money and materials:** progress draws, material requests/releases vs draw %,
  change orders, RFIs, job costing and margins.
- **Phase 3 – bids:** bid-inbox ingestion and sorting, bid log, win rates, follow-ups.
