#!/usr/bin/env python3
"""
One-command launcher for the Drywall Company Management App.

    Windows:      python run.py
    macOS/Linux:  python3 run.py

The only thing you need installed is Python 3.10 or newer. On the first run this
script downloads what's missing into this folder (nothing system-wide, no admin
rights needed):

  * Node.js        -> .tools/node      (only if Node 20+ isn't already installed)
  * MongoDB        -> .tools/mongodb   (only if no MongoDB is already running)
  * Python packages-> backend/.venv
  * App packages   -> frontend/node_modules

Then it creates the config files with random secrets, starts the database, the
backend API and the Expo app, opens the web version in your browser, and shows a
QR code you can scan with the Expo Go app on your phone.

Press Ctrl+C to stop everything.

Options:
    --no-browser   don't open the web version automatically
    --setup-only   install and configure everything, but don't start the app
"""
from __future__ import annotations

import hashlib
import os
import platform
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import urllib.request
import webbrowser
import zipfile
from pathlib import Path

# ----------------------------------------------------------------------------
# Settings
# ----------------------------------------------------------------------------
NODE_VERSION = "22.12.0"     # Node.js LTS used when Node isn't installed
NODE_MIN_MAJOR = 20
MONGO_VERSION = "7.0.14"     # MongoDB Community used when Mongo isn't installed
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
IS_WIN = os.name == "nt"
IS_MAC = sys.platform == "darwin"

children: list[subprocess.Popen] = []


# ----------------------------------------------------------------------------
# Output helpers
# ----------------------------------------------------------------------------
def step(msg: str) -> None:
    print(f"\n==> {msg}", flush=True)


def info(msg: str) -> None:
    print(f"    {msg}", flush=True)


def fail(msg: str) -> "None":
    print(f"\n[ERROR] {msg}\n", flush=True)
    stop_children()
    sys.exit(1)


# ----------------------------------------------------------------------------
# Generic helpers
# ----------------------------------------------------------------------------
def machine_arch() -> str:
    m = platform.machine().lower()
    if m in ("arm64", "aarch64"):
        return "arm64"
    if m in ("x86_64", "amd64", "x64"):
        return "x64"
    fail(f"Unsupported processor type: {platform.machine()}")
    return ""


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    info(f"Downloading {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with urllib.request.urlopen(url, timeout=60) as resp, open(tmp, "wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            last = -1
            while True:
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                if total:
                    pct = done * 100 // total
                    if pct // 10 != last // 10:
                        info(f"  {pct}%")
                        last = pct
        tmp.replace(dest)
    except Exception as e:  # noqa: BLE001
        tmp.unlink(missing_ok=True)
        fail(f"Download failed: {url}\n        {e}\n        Check your internet connection and run again.")


def extract(archive: Path, dest: Path) -> None:
    info(f"Unpacking {archive.name}")
    dest.mkdir(parents=True, exist_ok=True)
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            z.extractall(dest)
    else:
        with tarfile.open(archive) as t:
            if sys.version_info >= (3, 12):
                t.extractall(dest, filter="data")
            else:
                t.extractall(dest)
    archive.unlink(missing_ok=True)


def find_file(folder: Path, name: str) -> Path | None:
    for p in folder.rglob(name):
        if p.is_file():
            return p
    return None


def port_open(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def free_port(start: int) -> int:
    port = start
    while port_open(port) and port < start + 50:
        port += 1
    return port


def wait_for(check, what: str, timeout: int, log: Path | None = None) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if check():
            return
        time.sleep(1)
    hint = f"\n        See the log: {log}" if log else ""
    fail(f"{what} did not start within {timeout} seconds.{hint}")


def file_hash(*paths: Path) -> str:
    h = hashlib.sha256()
    for p in paths:
        if p.exists():
            h.update(p.read_bytes())
    return h.hexdigest()


def lan_ip() -> str:
    """The address your phone uses to reach this computer (no traffic is sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
            if not ip.startswith("127."):
                return ip
    except OSError:
        pass
    return "127.0.0.1"


def run(cmd: list[str], cwd: Path, env: dict | None = None, what: str = "") -> None:
    result = subprocess.run(cmd, cwd=cwd, env=env)
    if result.returncode != 0:
        fail(f"{what or ' '.join(cmd)} failed (exit code {result.returncode}). See the messages above.")


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip()
    return values


def write_env(path: Path, values: dict[str, str], header: str) -> None:
    lines = [f"# {header}"] + [f"{k}={v}" for k, v in values.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ----------------------------------------------------------------------------
# 1. Node.js
# ----------------------------------------------------------------------------
def node_major(node: str) -> int:
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=20).stdout
        return int(out.strip().lstrip("v").split(".")[0])
    except Exception:  # noqa: BLE001
        return 0


def ensure_node() -> Path:
    """Returns the folder that holds node + npm + npx, and puts it first on PATH."""
    step("Checking Node.js")
    system_node = shutil.which("node")
    if system_node and node_major(system_node) >= NODE_MIN_MAJOR and shutil.which("npm"):
        info(f"Using installed Node.js {subprocess.run([system_node, '--version'], capture_output=True, text=True).stdout.strip()}")
        return Path(system_node).parent

    node_home = TOOLS / "node"
    exe = "node.exe" if IS_WIN else "node"
    found = find_file(node_home, exe) if node_home.exists() else None
    if not found:
        arch = machine_arch()
        if IS_WIN:
            name, ext = f"node-v{NODE_VERSION}-win-{arch}", "zip"
        elif IS_MAC:
            name, ext = f"node-v{NODE_VERSION}-darwin-{arch}", "tar.gz"
        else:
            name, ext = f"node-v{NODE_VERSION}-linux-{arch}", "tar.gz"
        archive = TOOLS / f"{name}.{ext}"
        download(f"https://nodejs.org/dist/v{NODE_VERSION}/{name}.{ext}", archive)
        extract(archive, node_home)
        found = find_file(node_home, exe)
        if not found:
            fail("Node.js was downloaded but node could not be found inside it.")
    bin_dir = found.parent
    os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
    info(f"Using bundled Node.js {NODE_VERSION} from {bin_dir}")
    return bin_dir


def tool(name: str) -> str:
    """Full path to npm/npx (on Windows these are .cmd files)."""
    path = shutil.which(name)
    if not path:
        fail(f"Could not find {name} on this computer.")
    return path


# ----------------------------------------------------------------------------
# 2. MongoDB
# ----------------------------------------------------------------------------
def linux_mongo_target() -> str:
    os_release = read_env(Path("/etc/os-release"))
    distro = os_release.get("ID", "").strip('"')
    ver = os_release.get("VERSION_ID", "").strip('"')
    if distro == "debian" and ver.startswith("12"):
        return "debian12"
    if distro == "debian" and ver.startswith("11"):
        return "debian11"
    if distro == "ubuntu" and ver.startswith("20"):
        return "ubuntu2004"
    return "ubuntu2204"  # Ubuntu 22.04+, Mint, Pop!_OS and most others


def mongod_path() -> Path:
    system = shutil.which("mongod")
    if system:
        return Path(system)
    mongo_home = TOOLS / "mongodb"
    exe = "mongod.exe" if IS_WIN else "mongod"
    found = find_file(mongo_home, exe) if mongo_home.exists() else None
    if found:
        return found

    arch = machine_arch()
    if IS_WIN:
        url = f"https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-{MONGO_VERSION}.zip"
    elif IS_MAC:
        a = "arm64" if arch == "arm64" else "x86_64"
        url = f"https://fastdl.mongodb.org/osx/mongodb-macos-{a}-{MONGO_VERSION}.tgz"
    else:
        a = "aarch64" if arch == "arm64" else "x86_64"
        url = f"https://fastdl.mongodb.org/linux/mongodb-linux-{a}-{linux_mongo_target()}-{MONGO_VERSION}.tgz"
    archive = TOOLS / url.rsplit("/", 1)[1]
    download(url, archive)
    extract(archive, mongo_home)
    found = find_file(mongo_home, exe)
    if not found:
        fail("MongoDB was downloaded but mongod could not be found inside it.")
    if not IS_WIN:
        found.chmod(0o755)
    return found


def ensure_mongo(mongo_url: str) -> None:
    step("Checking the database (MongoDB)")
    local = "127.0.0.1" in mongo_url or "localhost" in mongo_url
    if not local:
        info("Using the remote database set in backend/.env (MONGO_URL).")
        return
    if port_open(MONGO_PORT):
        info(f"A database is already running on port {MONGO_PORT}; using it.")
        return

    mongod = mongod_path()
    db_dir = DATA / "db"
    db_dir.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(exist_ok=True)
    log = LOGS / "mongod.log"
    info(f"Starting MongoDB (data is kept in {db_dir})")
    proc = subprocess.Popen(
        [str(mongod), "--dbpath", str(db_dir), "--port", str(MONGO_PORT),
         "--bind_ip", "127.0.0.1", "--logpath", str(log), "--logappend"],
        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
        **new_group_kwargs(),
    )
    children.append(proc)
    wait_for(lambda: port_open(MONGO_PORT) or proc.poll() is not None, "MongoDB", 60, log)
    if proc.poll() is not None:
        fail(f"MongoDB stopped right after starting. See the log: {log}")
    info("MongoDB is running.")


# ----------------------------------------------------------------------------
# 3. Config files
# ----------------------------------------------------------------------------
def ensure_backend_env() -> dict[str, str]:
    step("Preparing configuration")
    path = BACKEND / ".env"
    values = read_env(path)
    created_password = None
    defaults = {
        "MONGO_URL": f"mongodb://127.0.0.1:{MONGO_PORT}",
        "DB_NAME": DB_NAME,
        "SECRET_KEY": secrets.token_urlsafe(48),
        "ADMIN_EMAIL": ADMIN_EMAIL,
        "ADMIN_NAME": "Administrator",
        "CORS_ORIGINS": "*",
    }
    for k, v in defaults.items():
        values.setdefault(k, v)
    if "ADMIN_PASSWORD" not in values:
        created_password = secrets.token_urlsafe(9)
        values["ADMIN_PASSWORD"] = created_password
    write_env(path, values, "Created by run.py. Keep this file private; it is not committed to git.")

    login_file = ROOT / "LOGIN_DETAILS.txt"
    if created_password or not login_file.exists():
        login_file.write_text(
            "First manager login for the Drywall app\n"
            f"Email:    {values['ADMIN_EMAIL']}\n"
            f"Password: {values['ADMIN_PASSWORD']}\n\n"
            "This account is created the first time the backend starts with an empty database.\n"
            "Change the password after you log in. This file is not committed to git.\n",
            encoding="utf-8",
        )
    info("backend/.env is ready (random secret key).")
    return values


def write_frontend_env(ip: str) -> str:
    url = f"http://{ip}:{BACKEND_PORT}"
    write_env(FRONTEND / ".env", {"EXPO_PUBLIC_BACKEND_URL": url},
              "Created by run.py on every start (your computer's network address can change).")
    info(f"The app will talk to the backend at {url}")
    return url


# ----------------------------------------------------------------------------
# 4. Dependencies
# ----------------------------------------------------------------------------
def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if IS_WIN else "bin/python")


def ensure_backend_deps() -> None:
    step("Installing backend packages (first run takes a minute or two)")
    if not venv_python().exists():
        info("Creating Python virtual environment in backend/.venv")
        run([sys.executable, "-m", "venv", str(VENV)], ROOT, what="Creating the virtual environment")
    stamp = VENV / ".requirements-hash"
    want = file_hash(BACKEND / "requirements.txt")
    if stamp.exists() and stamp.read_text() == want:
        info("Backend packages are up to date.")
        return
    py = str(venv_python())
    run([py, "-m", "pip", "install", "--disable-pip-version-check", "-q", "--upgrade", "pip"], BACKEND,
        what="Upgrading pip")
    run([py, "-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", "requirements.txt"], BACKEND,
        what="Installing backend packages")
    stamp.write_text(want)
    info("Backend packages installed.")


def ensure_frontend_deps() -> None:
    step("Installing app packages (first run takes a few minutes)")
    stamp = FRONTEND / "node_modules" / ".install-hash"
    want = file_hash(FRONTEND / "package.json", FRONTEND / "package-lock.json")
    if stamp.exists() and stamp.read_text() == want:
        info("App packages are up to date.")
        return
    npm = tool("npm")
    env = {**os.environ, "npm_config_fund": "false", "npm_config_audit": "false",
           "npm_config_update_notifier": "false"}
    result = subprocess.run([npm, "ci", "--loglevel=error"], cwd=FRONTEND, env=env)
    if result.returncode != 0:
        info("Clean install failed; retrying with a more forgiving install...")
        run([npm, "install", "--legacy-peer-deps", "--loglevel=error"], FRONTEND, env,
            what="Installing app packages")
    stamp.parent.mkdir(exist_ok=True)
    stamp.write_text(want)
    info("App packages installed.")


# ----------------------------------------------------------------------------
# 5. Start the services
# ----------------------------------------------------------------------------
def new_group_kwargs() -> dict:
    """Start helpers in their own process group so Ctrl+C is handled by this script."""
    if IS_WIN:
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def backend_healthy() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{BACKEND_PORT}/api/health", timeout=2) as r:
            return b'"healthy"' in r.read()
    except Exception:  # noqa: BLE001
        return False


def start_backend() -> None:
    step("Starting the backend API")
    if port_open(BACKEND_PORT):
        fail(f"Port {BACKEND_PORT} is already in use. Close the other program (or an old run.py window) and try again.")
    LOGS.mkdir(exist_ok=True)
    log_path = LOGS / "backend.log"
    log = open(log_path, "a", encoding="utf-8")
    proc = subprocess.Popen(
        [str(venv_python()), "-m", "uvicorn", "server:app",
         "--host", "0.0.0.0", "--port", str(BACKEND_PORT)],
        cwd=BACKEND, stdout=log, stderr=subprocess.STDOUT, **new_group_kwargs(),
    )
    children.append(proc)
    wait_for(lambda: backend_healthy() or proc.poll() is not None, "The backend", 90, log_path)
    if proc.poll() is not None:
        fail(f"The backend stopped right after starting. See the log: {log_path}")
    info(f"Backend is running: http://127.0.0.1:{BACKEND_PORT}/docs (API explorer)")


def start_expo(open_browser: bool, env_values: dict[str, str], backend_url: str) -> int:
    step("Starting the app (Expo)")
    port = free_port(EXPO_PORT)
    env = {**os.environ, "EXPO_NO_TELEMETRY": "1", "EXPO_PUBLIC_BACKEND_URL": backend_url}
    cmd = [tool("npx"), "expo", "start", "--lan", "--port", str(port)]

    login = ROOT / "LOGIN_DETAILS.txt"
    print("\n" + "=" * 68)
    print("  Drywall app is starting")
    print("-" * 68)
    print(f"  Web version:   http://localhost:{port}" + ("   (opens automatically)" if open_browser else ""))
    print("  On your phone: install 'Expo Go', then scan the QR code below")
    print("                 (phone and computer must be on the same Wi-Fi)")
    print(f"  Backend API:   http://127.0.0.1:{BACKEND_PORT}/docs")
    print(f"  Manager login: {env_values['ADMIN_EMAIL']} / {env_values['ADMIN_PASSWORD']}")
    print(f"                 (also saved in {login.name})")
    print(f"  Logs:          {LOGS}")
    print("  Stop:          press Ctrl+C in this window")
    print("=" * 68 + "\n", flush=True)

    if open_browser:
        def opener() -> None:
            deadline = time.time() + 180
            while time.time() < deadline:
                if port_open(port):
                    time.sleep(2)
                    webbrowser.open(f"http://localhost:{port}")
                    return
                time.sleep(1)
        import threading
        threading.Thread(target=opener, daemon=True).start()

    # Expo gets this terminal directly so its QR code and shortcuts work.
    proc = subprocess.Popen(cmd, cwd=FRONTEND, env=env)
    children.append(proc)
    return proc.wait()


def stop_children() -> None:
    for proc in reversed(children):
        if proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=10)
            except Exception:  # noqa: BLE001
                try:
                    proc.kill()
                except Exception:  # noqa: BLE001
                    pass
    children.clear()


# ----------------------------------------------------------------------------
def main() -> None:
    if sys.version_info < (3, 10):
        print("This launcher needs Python 3.10 or newer. Download it from https://www.python.org/downloads/")
        sys.exit(1)
    args = set(sys.argv[1:])
    open_browser = "--no-browser" not in args
    setup_only = "--setup-only" in args

    print("Drywall Company Management App - launcher")
    TOOLS.mkdir(exist_ok=True)

    try:
        ensure_node()
        env_values = ensure_backend_env()
        backend_url = write_frontend_env(lan_ip())
        ensure_backend_deps()
        ensure_frontend_deps()
        if setup_only:
            step("Setup finished. Run this script again without --setup-only to start the app.")
            return
        ensure_mongo(env_values["MONGO_URL"])
        start_backend()
        code = start_expo(open_browser, env_values, backend_url)
        if code not in (0, None):
            info(f"Expo exited with code {code}.")
    except KeyboardInterrupt:
        pass
    finally:
        if children:
            print("\nStopping the app, backend and database...", flush=True)
        stop_children()
        print("Stopped.", flush=True)


if __name__ == "__main__":
    main()
