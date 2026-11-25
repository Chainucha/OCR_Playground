"""Launch, check, and tear down an isolated OCR Playground instance for verification.

    python .claude/skills/verify-ocr-playground/scripts/verify.py up
    python .claude/skills/verify-ocr-playground/scripts/verify.py doctor
    python .claude/skills/verify-ocr-playground/scripts/verify.py down

Standard library only. State lives in .verify/state.json, logs in .verify/logs/, and evidence in
.verify/evidence/, which `down` never deletes.
"""

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
SKILL = Path(__file__).resolve().parents[1]
VERIFY = REPO / ".verify"
STATE = VERIFY / "state.json"
LOGS = VERIFY / "logs"
EVIDENCE = VERIFY / "evidence"
OUTPUTS = REPO / "web" / "amplify_outputs.json"
WEB_DIST = ".next-verify"

ENGINE_PORT = 8100
WEB_PORT = 3100
COGNITO_PORT = 5100
ENGINE_URL = f"http://127.0.0.1:{ENGINE_PORT}"
WEB_URL = f"http://localhost:{WEB_PORT}"

PLACEHOLDER_OUTPUTS = REPO / "web" / "amplify_outputs.placeholder.json"

WINDOWS = os.name == "nt"


def uv() -> list[str]:
    found = shutil.which("uv")
    return [found] if found else [sys.executable, "-m", "uv"]


def npx() -> str:
    found = shutil.which("npx")
    if not found:
        sys.exit("npx not found; install Node 20+")
    return found


def port_free(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def http(method: str, url: str, body: bytes | None = None, headers: dict | None = None, timeout: float = 10):
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def wait_for(label: str, check, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if check():
                print(f"  {label}: ready")
                return
        except (OSError, urllib.error.URLError, ValueError):
            pass
        time.sleep(1)
    sys.exit(f"{label} not ready after {timeout:.0f}s; see {LOGS}")


def spawn(name: str, cmd: list[str], cwd: Path, env: dict) -> int:
    log = open(LOGS / f"{name}.log", "w", encoding="utf-8")
    kwargs = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if WINDOWS else {"start_new_session": True}
    proc = subprocess.Popen(cmd, cwd=cwd, env={**os.environ, **env}, stdout=log, stderr=subprocess.STDOUT,
                            stdin=subprocess.DEVNULL, **kwargs)
    return proc.pid


def alive(pid: int) -> bool:
    if WINDOWS:
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        code = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return code.value == 259
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def kill_tree(pid: int) -> None:
    if WINDOWS:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def git_head() -> str:
    rev = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO, capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=REPO, capture_output=True, text=True).stdout.strip()
    return rev + ("+dirty" if dirty else "")


def prepare() -> None:
    print("Preparing dependencies")
    subprocess.run([*uv(), "sync", "-q", "--inexact", "--extra", "server", "--extra", "openthai-text"], cwd=REPO / "engines", check=True)
    if not (REPO / "models" / "openthai-text" / "runtime" / "line_engine.py").exists():
        subprocess.run([*uv(), "run", "ocr", "download", "openthai-text"], cwd=REPO / "engines", check=True)
    if not (REPO / "web" / "node_modules").exists():
        subprocess.run([shutil.which("npm") or "npm", "install"], cwd=REPO / "web", check=True)


def up() -> None:
    if STATE.exists():
        sys.exit(f"An instance is already recorded in {STATE}. Run doctor, or down first.")
    busy = [p for p in (ENGINE_PORT, WEB_PORT, COGNITO_PORT, COGNITO_PORT + 1) if not port_free(p)]
    if busy:
        sys.exit(f"Ports in use by something this run did not start: {busy}. Refusing to drive it.")
    prepare()
    LOGS.mkdir(parents=True, exist_ok=True)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    state = {"head": git_head(), "pids": {}, "created_outputs": False}

    if not OUTPUTS.exists():
        shutil.copyfile(PLACEHOLDER_OUTPUTS, OUTPUTS)
        state["created_outputs"] = True
    STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")

    print("Starting processes")
    cognito_json = VERIFY / "cognito.json"
    cognito_json.unlink(missing_ok=True)
    state["pids"]["cognito"] = spawn("cognito", [*uv(), "run", "-q", "--python", "3.12", "--with", "moto[server]",
                                                 "--with", "boto3", "python", str(REPO / "scripts" / "local_cognito.py"),
                                                 str(cognito_json), str(COGNITO_PORT)], REPO, {})
    STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    wait_for("cognito", cognito_json.exists, 180)
    cognito = json.loads(cognito_json.read_text(encoding="utf-8"))
    state["cognito"] = cognito

    state["pids"]["engine"] = spawn("engine", [*uv(), "run", "ocr", "serve", "--port", str(ENGINE_PORT)], REPO / "engines",
                                    {"OCR_CORS_ORIGINS": WEB_URL})
    STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    wait_for("engine", lambda: http("GET", f"{ENGINE_URL}/engines")[0] == 200, 120)

    web_env = {
        "NEXT_DIST_DIR": WEB_DIST,
        "NEXT_PUBLIC_OCR_API_URL": ENGINE_URL,
        "NEXT_PUBLIC_COGNITO_ENDPOINT": cognito["endpoint"],
        "NEXT_PUBLIC_COGNITO_USER_POOL_ID": cognito["user_pool_id"],
        "NEXT_PUBLIC_COGNITO_CLIENT_ID": cognito["client_id"],
    }
    print(f"  web: building into web/{WEB_DIST}")
    with open(LOGS / "web-build.log", "w", encoding="utf-8") as log:
        built = subprocess.run([npx(), "next", "build"], cwd=REPO / "web", env={**os.environ, **web_env},
                               stdout=log, stderr=subprocess.STDOUT)
    if built.returncode != 0:
        sys.exit(f"web build failed; see {LOGS / 'web-build.log'}. Run down to clean up.")
    state["pids"]["web"] = spawn("web", [npx(), "next", "start", "-p", str(WEB_PORT)], REPO / "web", web_env)
    STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    wait_for("web", lambda: b"<title>OCR Playground</title>" in http("GET", WEB_URL)[1], 60)

    print(f"\nUp at {WEB_URL}  (engine API {ENGINE_URL}, Cognito {cognito['endpoint']})")
    print(f"Sign in as {cognito['email']} / {cognito['password']}")
    print(f"Evidence dir: {EVIDENCE}")


def doctor() -> None:
    if not STATE.exists():
        sys.exit("No instance recorded. Run up.")
    state = json.loads(STATE.read_text(encoding="utf-8"))
    checks: list[tuple[str, bool, str]] = []
    for name, pid in state["pids"].items():
        checks.append((f"process {name}", alive(pid), f"pid {pid}"))

    try:
        status, body = http("GET", f"{ENGINE_URL}/engines")
        engines = {e["name"]: e for e in json.loads(body)} if status == 200 else {}
        ok = engines.get("openthai-text", {}).get("available", False)
        detail = ", ".join(f"{n}={'ready' if e['available'] else 'unavailable'}" for n, e in engines.items()) or f"HTTP {status}"
    except (OSError, ValueError) as exc:
        ok, detail = False, str(exc)
    checks.append(("engine API", ok, detail))

    try:
        status, body = http("GET", WEB_URL, timeout=60)
        ok, detail = status == 200 and b"<title>OCR Playground</title>" in body, f"HTTP {status}"
    except OSError as exc:
        ok, detail = False, str(exc)
    checks.append(("web", ok, detail))

    cognito = state.get("cognito", {})
    try:
        status, body = http("POST", cognito.get("endpoint", "http://127.0.0.1:0"),
                            json.dumps({"UserPoolId": cognito.get("user_pool_id")}).encode(),
                            {"Content-Type": "application/x-amz-json-1.1",
                             "X-Amz-Target": "AWSCognitoIdentityProviderService.DescribeUserPool"})
        ok = status == 200 and json.loads(body)["UserPool"]["Id"] == cognito.get("user_pool_id")
        detail = f"pool {cognito.get('user_pool_id')}"
    except (OSError, ValueError, KeyError) as exc:
        ok, detail = False, str(exc)
    checks.append(("cognito", ok, detail))

    head = git_head()
    checks.append(("build", head == state["head"], f"started at {state['head']}, checkout now {head}"))

    for label, ok, detail in checks:
        print(f"{'OK  ' if ok else 'FAIL'} {label:<18} {detail}")
    sys.exit(0 if all(ok for _, ok, _ in checks) else 1)


def down() -> None:
    if not STATE.exists():
        print("No instance recorded; nothing to stop.")
        return
    state = json.loads(STATE.read_text(encoding="utf-8"))
    for name, pid in reversed(list(state["pids"].items())):
        kill_tree(pid)
        print(f"stopped {name} (pid {pid})")
    if state.get("created_outputs"):
        OUTPUTS.unlink(missing_ok=True)
        print("removed placeholder web/amplify_outputs.json")
    (VERIFY / "cognito.json").unlink(missing_ok=True)
    STATE.unlink()
    print(f"Evidence kept in {EVIDENCE}")


if __name__ == "__main__":
    commands = {"up": up, "doctor": doctor, "down": down}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        sys.exit(f"usage: verify.py {{{'|'.join(commands)}}}")
    commands[sys.argv[1]]()
