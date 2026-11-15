# Drywall Company Management App

Mobile app (Expo / React Native) with a FastAPI backend and MongoDB, for running a
commercial drywall, steel stud framing, insulation and acoustics company.
Built on the OakdaleApp1 codebase and being extended role by role:
estimators/coordinators, project managers, foremen and employees.

## Run it (one command)

You only need **Python 3.10+** installed ([python.org/downloads](https://www.python.org/downloads/);
on Windows tick **"Add python.exe to PATH"** in the installer).

```bash
# Windows
python run.py

# macOS / Linux
python3 run.py
```

The first run downloads everything else into this folder (Node.js if you don't have it,
MongoDB, Python and app packages). That takes 5–10 minutes once; later starts take seconds.
When it's ready it:

- opens the **web version** in your browser,
- shows a **QR code**: scan it with the **Expo Go** app on your phone (same Wi-Fi),
- prints the **manager login** (also saved in `LOGIN_DETAILS.txt`).

Press **Ctrl+C** to stop everything.

| Option | What it does |
|---|---|
| `--no-browser` | Don't open the web version automatically |
| `--setup-only` | Install and configure, but don't start |

### Where things live

| Path | What it is (none of these are committed to git) |
|---|---|
| `backend/.env` | Database address, random secret key, first admin login |
| `frontend/.env` | Backend address for the app (rewritten on each start) |
| `.data/db` | Your local database |
| `.logs/` | `backend.log` and `mongod.log` if something goes wrong |
| `.tools/` | Downloaded Node.js / MongoDB |

To use a hosted database (e.g. MongoDB Atlas) instead, change `MONGO_URL` in `backend/.env`.

### Troubleshooting

- **Windows asks to allow Python/Node through the firewall:** click *Allow* (private networks),
  otherwise your phone can't reach the app.
- **"python is not recognized" / opens the Microsoft Store:** reinstall Python from python.org with
  "Add to PATH" ticked.
- **Phone can't connect:** make sure phone and computer are on the same Wi-Fi (not a guest network).
- **Port 8000 already in use:** close the other run.py window and try again.

## Project layout

```
backend/   FastAPI API (server.py), requirements.txt
frontend/  Expo app: app/manager/*, app/worker/* screens, src/services/* API clients
run.py     one-command launcher
```

## Roadmap

- **Phase 0 – foundation:** ✅ clean repo, ✅ no default login or hardcoded secret, ✅ CORS config,
  ✅ launcher; next: role/permission model with project scoping, split API into modules,
  Site → Project, file storage outside the database.
- **Phase 1 – field operations:** employee profiles (pay, specialty, certs), server-side GPS radius
  and job shutdown, scope workflows and hour budgets with over-budget flags, safety expiry alerts
  (2 weeks employee / 1 week + expired foreman), foreman forms, manpower requests, dashboards.
- **Phase 2 – money and materials:** progress draws, material requests/releases vs draw %,
  change orders, RFIs, job costing and margins.
- **Phase 3 – bids:** bid-inbox ingestion and sorting, bid log, win rates, follow-ups.
