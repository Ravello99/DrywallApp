#!/usr/bin/env python3
"""
One-command launcher for the Drywall Company Management App, for an Ubuntu 20.04
(or newer) server. No sudo, no prompts.

    python3 run.py            set up everything, start it in the background,
                              and make it start again when the server reboots
    python3 run.py status     is it running? shows the addresses again
    python3 run.py stop       stop everything (and don't start on reboot)
    python3 run.py logs       follow the logs (Ctrl+C to stop watching)

Options for the first command:
    --host <name-or-IP>   address phones and browsers use to reach this server
                          (default: the server's public IP, detected automatically;
                          the choice is remembered in .data/launcher.json)
    --no-expo             don't run the Expo dev server (only the web app + API)

Ubuntu 20.04's own Python is 3.8, which is fine for running this script. What the
app needs is downloaded into this folder on the first run (nothing system-wide):

  * Python 3.12   -> .tools/python    (for the backend; skipped if 3.10+ is installed)
  * Node.js 22    -> .tools/node      (skipped if Node 20+ is installed)
  * MongoDB       -> .tools/mongodb   (7.0, or 4.4 on CPUs without AVX)
  * packages      -> backend/.venv and frontend/node_modules

What runs (all supervised and restarted automatically if one crashes):

  * MongoDB on 127.0.0.1:27017 (not reachable from outside)
  * Backend API + web app on port 8000   ->  http://<host>:8000
  * Expo dev server on port 8081          ->  phones open it in the Expo Go app
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

# ----------------------------------------------------------------------------
# Settings
# ----------------------------------------------------------------------------
PYTHON_BUILD = ("20241016", "3.12.7")   # python-build-standalone release, CPython version
NODE_VERSION = "22.12.0"
NODE_MIN_MAJOR = 20
MONGO_VERSION = "7.0.14"
MONGO_VERSION_NO_AVX = "4.4.29"         # last MongoDB that runs on CPUs without AVX
MONGO_PORT = 27017
BACKEND_PORT = 8000
EXPO_PORT = 8081
DB_NAME = "drywall_app"
ADMIN_EMAIL = "admin@drywall.local"

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
TOOLS = ROOT / ".tools"
DATA = ROOT / ".data"
LOGS = ROOT / ".logs"
VENV = BACKEND / ".venv"
STATE_FILE = DATA / "launcher.json"
PID_FILE = DATA / "launcher.pid"
LOGIN_FILE = ROOT / "LOGIN_DETAILS.txt"
CRON_TAG = "# drywall-app-autostart"


# ----------------------------------------------------------------------------
# Output and small helpers
# ----------------------------------------------------------------------------
def step(msg: str) -> None:
    print("\n==> " + msg, flush=True)


def info(msg: str) -> None:
    print("    " + msg, flush=True)


def fail(msg: str) -> None:
    print("\n[ERROR] " + msg + "\n", flush=True)
    sys.exit(1)


def log_line(msg: str) -> None:
    """Supervisor messages go to .logs/launcher.log."""
    print(time.strftime("%Y-%m-%d %H:%M:%S ") + msg, flush=True)


def arch() -> str:
    m = platform.machine().lower()
    if m in ("x86_64", "amd64"):
        return "x86_64"
    if m in ("aarch64", "arm64"):
        return "aarch64"
    fail("Unsupported processor type: " + platform.machine())
    return ""


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    info("Downloading " + url)
    tmp = Path(str(dest) + ".part")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "drywall-app-launcher"})
        with urllib.request.urlopen(req, timeout=60) as resp, open(str(tmp), "wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            done, shown = 0, -10
            while True:
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                if total and done * 100 // total >= shown + 10:
                    shown = done * 100 // total
                    info("  %d%%" % shown)
        tmp.replace(dest)
    except Exception as e:  # noqa: BLE001
        if tmp.exists():
            tmp.unlink()
        fail("Download failed: %s\n        %s\n        Check the server's internet access and run again." % (url, e))


def extract(archive: Path, dest: Path) -> None:
    info("Unpacking " + archive.name)
    dest.mkdir(parents=True, exist_ok=True)
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(str(archive)) as z:
            z.extractall(str(dest))
    else:
        with tarfile.open(str(archive)) as t:
            if hasattr(tarfile, "data_filter"):
                t.extractall(str(dest), filter="data")
            else:
                t.extractall(str(dest))
    archive.unlink()


def find_file(folder: Path, name: str):
    if not folder.exists():
        return None
    for p in sorted(folder.rglob(name)):
        if p.is_file():
            return p
    return None


def port_open(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def file_hash(*parts) -> str:
    h = hashlib.sha256()
    for p in parts:
        if isinstance(p, Path):
            if p.exists():
                h.update(p.read_bytes())
        else:
            h.update(str(p).encode())
    return h.hexdigest()


def run(cmd, cwd: Path, env=None, what: str = "") -> None:
    result = subprocess.run([str(c) for c in cmd], cwd=str(cwd), env=env)
    if result.returncode != 0:
        fail("%s failed (exit code %d). See the messages above." % (what or cmd[0], result.returncode))


def read_env(path: Path) -> dict:
    values = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip().strip('"')
    return values


def write_env(path: Path, values: dict, header: str) -> None:
    lines = ["# " + header] + ["%s=%s" % (k, v) for k, v in values.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    path.chmod(0o600)


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:  # noqa: BLE001
        return {}


def save_state(state: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


# ----------------------------------------------------------------------------
# Network address
# ----------------------------------------------------------------------------
def local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no traffic is sent
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def public_ip():
    for url in ("https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "curl/7.68.0"})
            with urllib.request.urlopen(req, timeout=5) as r:
                ip = r.read().decode().strip()
                socket.inet_aton(ip)
                return ip
        except Exception:  # noqa: BLE001
            continue
    return None


def choose_host(cli_host) -> str:
    """Employees clock in from job sites over cellular data, so the default is the
    server's public address. Use --host for a domain name or an office-only IP."""
    state = load_state()
    if cli_host:
        host = cli_host
    elif state.get("host"):
        host = state["host"]
    else:
        host = public_ip() or local_ip()
    state["host"] = host
    save_state(state)
    return host


# ----------------------------------------------------------------------------
# Python 3.10+ for the backend
# ----------------------------------------------------------------------------
def ensure_python() -> str:
    """Always uses a bundled Python 3.12: Ubuntu 20.04 ships 3.8, and Ubuntu's own
    Pythons often lack venv/ensurepip unless extra apt packages are installed."""
    step("Checking Python for the backend")
    home = TOOLS / "python"
    exe = home / "python" / "bin" / "python3"
    if not exe.exists():
        release, version = PYTHON_BUILD
        name = "cpython-%s+%s-%s-unknown-linux-gnu-install_only.tar.gz" % (version, release, arch())
        archive = TOOLS / name
        download("https://github.com/astral-sh/python-build-standalone/releases/download/%s/%s"
                 % (release, name.replace("+", "%2B")), archive)
        extract(archive, home)
        if not exe.exists():
            fail("Python was downloaded but python3 could not be found inside it.")
    info("Using bundled Python %s for the backend" % PYTHON_BUILD[1])
    return str(exe)


# ----------------------------------------------------------------------------
# Node.js
# ----------------------------------------------------------------------------
def node_major(node: str) -> int:
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=20).stdout
        return int(out.strip().lstrip("v").split(".")[0])
    except Exception:  # noqa: BLE001
        return 0


def bundled_node():
    hits = sorted((TOOLS / "node").glob("node-v*/bin/node"))
    return hits[-1] if hits else None


def node_bin_dir() -> Path:
    """Folder with node/npm/npx. Downloads Node if needed. Doesn't print."""
    system = shutil.which("node")
    if system and node_major(system) >= NODE_MIN_MAJOR and shutil.which("npm"):
        return Path(system).parent
    found = bundled_node()
    if found:
        return found.parent
    a = "x64" if arch() == "x86_64" else "arm64"
    name = "node-v%s-linux-%s" % (NODE_VERSION, a)
    archive = TOOLS / (name + ".tar.gz")
    download("https://nodejs.org/dist/v%s/%s.tar.gz" % (NODE_VERSION, name), archive)
    extract(archive, TOOLS / "node")
    found = bundled_node()
    if not found:
        fail("Node.js was downloaded but node could not be found inside it.")
    return found.parent


def ensure_node() -> Path:
    step("Checking Node.js")
    bin_dir = node_bin_dir()
    info("Using Node.js %s from %s" % (
        subprocess.run([str(bin_dir / "node"), "--version"], capture_output=True, text=True).stdout.strip(), bin_dir))
    return bin_dir


def node_env(bin_dir: Path) -> dict:
    env = dict(os.environ)
    env["PATH"] = str(bin_dir) + os.pathsep + env.get("PATH", "")
    env.update({"npm_config_fund": "false", "npm_config_audit": "false",
                "npm_config_update_notifier": "false", "EXPO_NO_TELEMETRY": "1"})
    return env


# ----------------------------------------------------------------------------
# MongoDB
# ----------------------------------------------------------------------------
def cpu_has_avx() -> bool:
    try:
        return " avx " in (" " + Path("/proc/cpuinfo").read_text().replace("\n", " ") + " ")
    except OSError:
        return True


def linux_target(version: str) -> str:
    rel = read_env(Path("/etc/os-release"))
    distro, ver = rel.get("ID", ""), rel.get("VERSION_ID", "")
    if distro == "debian":
        return "debian12" if ver.startswith("12") and not version.startswith("4.") else "debian11" if ver.startswith("11") else "debian10"
    if distro == "ubuntu" and ver.startswith("20"):
        return "ubuntu2004"
    if version.startswith("4."):
        return "ubuntu2004"
    return "ubuntu2204"


def ensure_mongod() -> Path:
    step("Checking the database (MongoDB)")
    system = shutil.which("mongod")
    if system:
        info("Using installed MongoDB: " + system)
        return Path(system)
    found = find_file(TOOLS / "mongodb", "mongod")
    if not found:
        version = MONGO_VERSION
        if arch() == "x86_64" and not cpu_has_avx():
            version = MONGO_VERSION_NO_AVX
            info("This CPU has no AVX support, so MongoDB %s is used instead of %s." % (version, MONGO_VERSION))
        target = linux_target(version)
        name = "mongodb-linux-%s-%s-%s.tgz" % (arch(), target, version)
        archive = TOOLS / name
        download("https://fastdl.mongodb.org/linux/" + name, archive)
        extract(archive, TOOLS / "mongodb")
        found = find_file(TOOLS / "mongodb", "mongod")
        if not found:
            fail("MongoDB was downloaded but mongod could not be found inside it.")
        found.chmod(0o755)
    check = subprocess.run([str(found), "--version"], capture_output=True, text=True)
    if check.returncode != 0:
        msg = (check.stderr or check.stdout).strip()
        hint = ""
        if "libcurl" in msg:
            hint = "\n        Fix: sudo apt-get install -y libcurl4   then run this script again."
        elif "libssl" in msg or "libcrypto" in msg:
            hint = "\n        Fix: sudo apt-get install -y openssl libssl1.1   then run this script again."
        elif "Illegal instruction" in msg or check.returncode in (-4, 132):
            hint = "\n        This CPU can't run this MongoDB build. Delete .tools/mongodb and run again."
        fail("MongoDB can't run on this server:\n        " + msg[-400:] + hint)
    info("MongoDB is ready: " + found.parent.as_posix())
    return found


# ----------------------------------------------------------------------------
# Config files
# ----------------------------------------------------------------------------
def ensure_backend_env() -> dict:
    step("Preparing configuration")
    path = BACKEND / ".env"
    values = read_env(path)
    new_password = None
    for k, v in (("MONGO_URL", "mongodb://127.0.0.1:%d" % MONGO_PORT), ("DB_NAME", DB_NAME),
                 ("SECRET_KEY", secrets.token_urlsafe(48)), ("ADMIN_EMAIL", ADMIN_EMAIL),
                 ("ADMIN_NAME", "Administrator"), ("CORS_ORIGINS", "*")):
        values.setdefault(k, v)
    if "ADMIN_PASSWORD" not in values:
        new_password = secrets.token_urlsafe(9)
        values["ADMIN_PASSWORD"] = new_password
    write_env(path, values, "Created by run.py. Keep this file private; it is not committed to git.")
    if new_password or not LOGIN_FILE.exists():
        LOGIN_FILE.write_text(
            "First manager login for the Drywall app\n"
            "Email:    %s\nPassword: %s\n\n"
            "This account is created the first time the backend starts with an empty database.\n"
            "Change the password after you log in. This file is not committed to git.\n"
            % (values["ADMIN_EMAIL"], values["ADMIN_PASSWORD"]), encoding="utf-8")
        LOGIN_FILE.chmod(0o600)
    info("backend/.env is ready (random secret key, private to your user).")
    return values


def write_frontend_env(host: str) -> str:
    url = "http://%s:%d" % (host, BACKEND_PORT)
    write_env(FRONTEND / ".env", {"EXPO_PUBLIC_BACKEND_URL": url},
              "Created by run.py from the server address (python3 run.py --host ... to change it).")
    info("The app will talk to the backend at " + url)
    return url


# ----------------------------------------------------------------------------
# Packages and web build
# ----------------------------------------------------------------------------
def venv_python() -> Path:
    return VENV / "bin" / "python"


def ensure_backend_deps(base_python: str) -> None:
    step("Installing backend packages (first run takes a minute or two)")
    stamp = VENV / ".requirements-hash"
    want = file_hash(BACKEND / "requirements.txt", base_python)
    if venv_python().exists() and stamp.exists() and stamp.read_text() == want:
        info("Backend packages are up to date.")
        return
    if VENV.exists():
        shutil.rmtree(str(VENV))
    run([base_python, "-m", "venv", VENV], ROOT, what="Creating the backend virtual environment")
    py = venv_python()
    run([py, "-m", "pip", "install", "--disable-pip-version-check", "-q", "--upgrade", "pip"], BACKEND,
        what="Upgrading pip")
    run([py, "-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", "requirements.txt"], BACKEND,
        what="Installing backend packages")
    stamp.write_text(want)
    info("Backend packages installed.")


def ensure_frontend_deps(env: dict) -> None:
    step("Installing app packages (first run takes a few minutes)")
    stamp = FRONTEND / "node_modules" / ".install-hash"
    want = file_hash(FRONTEND / "package.json", FRONTEND / "package-lock.json")
    if stamp.exists() and stamp.read_text() == want:
        info("App packages are up to date.")
        return
    npm = shutil.which("npm", path=env["PATH"])
    if subprocess.run([npm, "ci", "--loglevel=error"], cwd=str(FRONTEND), env=env).returncode != 0:
        info("Clean install failed; retrying with a more forgiving install...")
        run([npm, "install", "--legacy-peer-deps", "--loglevel=error"], FRONTEND, env, what="Installing app packages")
    stamp.parent.mkdir(exist_ok=True)
    stamp.write_text(want)
    info("App packages installed.")


def build_web(env: dict, backend_url: str) -> None:
    step("Building the web version of the app")
    dist = FRONTEND / "dist"
    stamp = DATA / "web-build-hash"
    sources = [FRONTEND / "package-lock.json", FRONTEND / "app.json", backend_url]
    for folder in ("app", "src", "assets"):
        sources += sorted(p for p in (FRONTEND / folder).rglob("*") if p.is_file())
    want = file_hash(*sources)
    if (dist / "index.html").exists() and stamp.exists() and stamp.read_text() == want:
        info("Web version is up to date.")
        return
    build_env = dict(env)
    build_env["EXPO_PUBLIC_BACKEND_URL"] = backend_url
    build_env.setdefault("NODE_OPTIONS", "--max-old-space-size=3072")
    npx = shutil.which("npx", path=env["PATH"])
    run([npx, "expo", "export", "--platform", "web", "--output-dir", "dist", "--clear"], FRONTEND, build_env,
        what="Building the web app (if this ran out of memory, the server needs at least 2 GB RAM or swap)")
    stamp.write_text(want)
    info("Web version built.")


# ----------------------------------------------------------------------------
# Supervisor: runs in the background and restarts anything that stops
# ----------------------------------------------------------------------------
def supervisor_pid():
    try:
        pid = int(PID_FILE.read_text().strip())
        os.kill(pid, 0)
        cmdline = Path("/proc/%d/cmdline" % pid).read_bytes().decode(errors="ignore")
        if "run.py" in cmdline and "--serve" in cmdline:
            return pid
    except Exception:  # noqa: BLE001
        pass
    return None


def backend_healthy() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/health" % BACKEND_PORT, timeout=2) as r:
            return b'"healthy"' in r.read()
    except Exception:  # noqa: BLE001
        return False


def serve() -> None:
    """Started in the background by `python3 run.py` and on reboot by cron."""
    LOGS.mkdir(exist_ok=True)
    PID_FILE.write_text(str(os.getpid()))
    state = load_state()
    host = state.get("host") or local_ip()
    env_values = read_env(BACKEND / ".env")
    node_env_ = node_env(Path(state["node_bin"]) if state.get("node_bin") else node_bin_dir())

    services = []  # (name, command, cwd, env, log file)
    mongo_local = "127.0.0.1" in env_values.get("MONGO_URL", "") or "localhost" in env_values.get("MONGO_URL", "")
    if mongo_local and not port_open(MONGO_PORT):
        mongod = state.get("mongod") or shutil.which("mongod") or str(find_file(TOOLS / "mongodb", "mongod"))
        (DATA / "db").mkdir(parents=True, exist_ok=True)
        services.append(("mongodb", [mongod, "--dbpath", str(DATA / "db"), "--port", str(MONGO_PORT),
                                     "--bind_ip", "127.0.0.1"], ROOT, None, LOGS / "mongod.log"))
    backend_env = dict(os.environ)
    backend_env["FRONTEND_DIST"] = str(FRONTEND / "dist")
    services.append(("backend", [str(venv_python()), "-m", "uvicorn", "server:app", "--host", "0.0.0.0",
                                 "--port", str(BACKEND_PORT), "--proxy-headers"], BACKEND, backend_env,
                     LOGS / "backend.log"))
    if state.get("expo", True):
        expo_env = dict(node_env_)
        expo_env.update({"CI": "1", "REACT_NATIVE_PACKAGER_HOSTNAME": host,
                         "EXPO_PUBLIC_BACKEND_URL": "http://%s:%d" % (host, BACKEND_PORT)})
        services.append(("expo", [shutil.which("npx", path=expo_env["PATH"]), "expo", "start", "--lan",
                                  "--port", str(EXPO_PORT)], FRONTEND, expo_env, LOGS / "expo.log"))

    procs = {}
    restarts = {name: [] for name, *_ in services}
    stopping = {"flag": False}

    def start(svc):
        name, cmd, cwd, env, log = svc
        fh = open(str(log), "a", encoding="utf-8")
        fh.write("\n----- %s starting %s -----\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), name))
        fh.flush()
        procs[name] = subprocess.Popen(cmd, cwd=str(cwd), env=env, stdout=fh, stderr=subprocess.STDOUT,
                                       stdin=subprocess.DEVNULL, start_new_session=True)
        log_line("started %s (pid %d)" % (name, procs[name].pid))

    def shutdown(*_):
        stopping["flag"] = True

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    log_line("supervisor starting (host %s)" % host)
    for svc in services:
        start(svc)
        if svc[0] == "mongodb":
            for _ in range(60):
                if port_open(MONGO_PORT):
                    break
                time.sleep(1)

    while not stopping["flag"]:
        time.sleep(3)
        for svc in services:
            name = svc[0]
            if stopping["flag"] or procs[name].poll() is None:
                continue
            now = time.time()
            restarts[name] = [t for t in restarts[name] if now - t < 600] + [now]
            delay = min(60, 2 ** len(restarts[name]))
            log_line("%s stopped (exit %s); restarting in %ds" % (name, procs[name].returncode, delay))
            time.sleep(delay)
            if not stopping["flag"]:
                start(svc)

    log_line("supervisor stopping")
    for svc in reversed(services):  # stop the app first, the database last
        p = procs.get(svc[0])
        if p and p.poll() is None:
            try:
                os.killpg(p.pid, signal.SIGTERM)
                p.wait(timeout=20)
            except Exception:  # noqa: BLE001
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except Exception:  # noqa: BLE001
                    pass
    if PID_FILE.exists():
        PID_FILE.unlink()
    log_line("stopped")


def stop() -> bool:
    pid = supervisor_pid()
    if not pid:
        return False
    os.kill(pid, signal.SIGTERM)
    for _ in range(40):
        if not supervisor_pid():
            break
        time.sleep(1)
    return True


def start_background() -> None:
    LOGS.mkdir(exist_ok=True)
    log = open(str(LOGS / "launcher.log"), "a")
    subprocess.Popen([sys.executable, str(ROOT / "run.py"), "--serve"], cwd=str(ROOT), stdout=log,
                     stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)


def set_autostart(enabled: bool) -> bool:
    if not shutil.which("crontab"):
        return False
    current = subprocess.run(["crontab", "-l"], capture_output=True, text=True).stdout
    lines = [l for l in current.splitlines() if CRON_TAG not in l]
    if enabled:
        lines.append("@reboot cd '%s' && sleep 20 && '%s' run.py --serve >> .logs/launcher.log 2>&1 %s"
                     % (ROOT, sys.executable, CRON_TAG))
    text = "\n".join(lines) + ("\n" if lines else "")
    return subprocess.run(["crontab", "-"], input=text, text=True).returncode == 0


# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------
def print_summary() -> None:
    state = load_state()
    host = state.get("host", "?")
    env_values = read_env(BACKEND / ".env")
    running = supervisor_pid() is not None
    print("\n" + "=" * 70)
    print("  Drywall app: " + ("RUNNING" if running else "STOPPED"))
    print("-" * 70)
    print("  Web app (office, any browser):  http://%s:%d" % (host, BACKEND_PORT))
    print("  API explorer:                   http://%s:%d/docs" % (host, BACKEND_PORT))
    if state.get("expo", True):
        print("  Phones (Expo Go app):           exp://%s:%d   (or scan the QR code)" % (host, EXPO_PORT))
    print("  Manager login:                  %s / %s" % (env_values.get("ADMIN_EMAIL", "?"),
                                                         env_values.get("ADMIN_PASSWORD", "?")))
    print("                                  (also in %s)" % LOGIN_FILE.name)
    print("  Logs:                           python3 run.py logs   (files in .logs/)")
    print("  Stop:                           python3 run.py stop")
    print("=" * 70)
    if running and state.get("expo", True):
        qr = FRONTEND / "node_modules" / "qrcode-terminal"
        node_dir = Path(state["node_bin"]) if state.get("node_bin") else node_bin_dir()
        node = shutil.which("node", path=str(node_dir))
        if qr.exists() and node:
            subprocess.run([node, "-e", "require(process.argv[1]).generate(process.argv[2],{small:true})",
                            str(qr), "exp://%s:%d" % (host, EXPO_PORT)])
    print("  Ports %d and %d must be open in the server's firewall / cloud security group." %
          (BACKEND_PORT, EXPO_PORT))
    print("  Web clock-in needs HTTPS (browser rule); the Expo Go app works over plain HTTP.\n", flush=True)


# ----------------------------------------------------------------------------
def main() -> None:
    args = sys.argv[1:]
    if not sys.platform.startswith("linux"):
        fail("This launcher is for the Ubuntu server.")
    if sys.version_info < (3, 8):
        fail("This launcher needs Python 3.8 or newer.")
    if "--serve" in args:
        return serve()
    if args[:1] == ["stop"]:
        stopped = stop()
        set_autostart(False)
        print("Stopped." if stopped else "It wasn't running.")
        print("It will no longer start on reboot. Run  python3 run.py  to start it again.")
        return
    if args[:1] == ["status"]:
        return print_summary()
    if args[:1] == ["logs"]:
        LOGS.mkdir(exist_ok=True)
        files = [str(p) for p in sorted(LOGS.glob("*.log"))]
        if not files:
            fail("No logs yet.")
        os.execvp("tail", ["tail", "-n", "40", "-F"] + files)

    cli_host = None
    if "--host" in args:
        i = args.index("--host")
        if i + 1 >= len(args):
            fail("--host needs a value, e.g.  python3 run.py --host app.mycompany.com")
        cli_host = args[i + 1]

    print("Drywall Company Management App - server setup")
    if os.geteuid() == 0:
        info("Note: running as root works, but a normal user account is recommended.")
    for d in (TOOLS, DATA, LOGS):
        d.mkdir(exist_ok=True)

    base_python = ensure_python()
    bin_dir = ensure_node()
    env = node_env(bin_dir)
    mongod = ensure_mongod()
    ensure_backend_env()
    step("Working out the server address")
    host = choose_host(cli_host)
    state = load_state()
    state["expo"] = "--no-expo" not in args
    state["node_bin"] = str(bin_dir)
    state["mongod"] = str(mongod)
    save_state(state)
    info("Address for phones and browsers: %s  (change with --host)" % host)
    backend_url = write_frontend_env(host)
    ensure_backend_deps(base_python)
    ensure_frontend_deps(env)
    build_web(env, backend_url)

    step("Starting everything in the background")
    if stop():
        info("Stopped the copy that was already running.")
    if port_open(BACKEND_PORT):
        fail("Port %d is already used by another program. Find it with:  sudo ss -ltnp 'sport = :%d'"
             % (BACKEND_PORT, BACKEND_PORT))
    start_background()
    deadline = time.time() + 120
    while time.time() < deadline and not backend_healthy():
        time.sleep(2)
    if not backend_healthy():
        fail("The backend didn't come up within 2 minutes. See:  python3 run.py logs")
    info("Backend and database are running.")
    if state["expo"]:
        info("Expo dev server is starting for phones (can take a minute; see .logs/expo.log).")
    if set_autostart(True):
        info("It will start again automatically when the server reboots.")
    else:
        info("Couldn't set up start-on-reboot (crontab not available); run this script after a reboot.")
    print_summary()


if __name__ == "__main__":
    main()
