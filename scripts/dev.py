"""Local development environment with hot reload and local sign-in. No AWS account needed.

    python scripts/dev.py

Starts three processes and streams their output, prefixed by name. Ctrl+C stops everything it started.

    web      http://localhost:3000     next dev: edits under web/src show up in the page
    engine   http://127.0.0.1:8000     ocr serve --reload: edits under engines/src restart the API
    cognito  http://127.0.0.1:9229     local Cognito (moto) with one invited user, printed at start

The engine API reads the repo-root .env when it exists (see .env.example). After an engine restart, each model
loads again on its next page. Standard library only; the verification skill (.claude/skills/verify-ocr-playground)
runs a separate, production-built instance on other ports, so both can run at once.
"""

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DEV = REPO / ".dev"
OUTPUTS = REPO / "web" / "amplify_outputs.json"
WINDOWS = os.name == "nt"

WEB_PORT, ENGINE_PORT, COGNITO_PORT = 3000, 8000, 9229
WEB_URL = f"http://localhost:{WEB_PORT}"
ENGINE_URL = f"http://127.0.0.1:{ENGINE_PORT}"

# web/src/app/providers.tsx imports amplify_outputs.json, which `npx ampx sandbox` writes. Without a sandbox the
# page signs in against local Cognito instead, and this file only has to exist.
PLACEHOLDER_OUTPUTS = {
    "version": "1.4",
    "auth": {
        "aws_region": "ap-southeast-1",
        "user_pool_id": "ap-southeast-1_DEVPLACEHOLDER",
        "user_pool_client_id": "devplaceholder",
        "username_attributes": ["email"],
        "standard_required_attributes": ["email"],
        "user_verification_types": ["email"],
        "password_policy": {"min_length": 8, "require_lowercase": True, "require_numbers": True,
                            "require_symbols": True, "require_uppercase": True},
        "unauthenticated_identities_enabled": False,
    },
}


def uv() -> list[str]:
    found = shutil.which("uv")
    return [found] if found else [sys.executable, "-m", "uv"]


def tool(name: str) -> str:
    found = shutil.which(name)
    if not found:
        sys.exit(f"{name} not found; install Node 20+")
    return found


def port_free(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def get(url: str) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def prepare() -> None:
    print("Preparing dependencies (uv sync --inexact keeps extras you installed yourself)")
    subprocess.run([*uv(), "sync", "-q", "--inexact", "--extra", "server", "--extra", "openthai-text"],
                   cwd=REPO / "engines", check=True)
    if not (REPO / "models" / "openthai-text" / "runtime" / "line_engine.py").exists():
        subprocess.run([*uv(), "run", "ocr", "download", "openthai-text"], cwd=REPO / "engines", check=True)
    if not (REPO / "web" / "node_modules").exists():
        subprocess.run([tool("npm"), "install"], cwd=REPO / "web", check=True)


class Stack:
    """The processes this run started, so Ctrl+C or a crash stops exactly those."""

    def __init__(self) -> None:
        self.procs: dict[str, subprocess.Popen] = {}

    def start(self, name: str, cmd: list[str], cwd: Path, env: dict | None = None) -> None:
        group = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if WINDOWS else {"start_new_session": True}
        proc = subprocess.Popen(cmd, cwd=cwd, env={**os.environ, "PYTHONIOENCODING": "utf-8", **(env or {})},
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                text=True, encoding="utf-8", errors="replace", bufsize=1, **group)
        self.procs[name] = proc
        threading.Thread(target=self._stream, args=(name, proc), daemon=True).start()

    @staticmethod
    def _stream(name: str, proc: subprocess.Popen) -> None:
        for line in proc.stdout:
            print(f"[{name:<7}] {line}", end="", flush=True)

    def wait_until(self, name: str, ready, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.procs[name].poll() is not None:
                raise RuntimeError(f"{name} exited with code {self.procs[name].returncode} while starting")
            try:
                if ready():
                    return
            except (OSError, ValueError):
                pass
            time.sleep(1)
        raise RuntimeError(f"{name} not ready after {timeout:.0f}s")

    def exited(self) -> str | None:
        return next((name for name, p in self.procs.items() if p.poll() is not None), None)

    def stop(self) -> None:
        for name, proc in reversed(self.procs.items()):
            if proc.poll() is not None:
                continue
            if WINDOWS:
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
            else:
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            print(f"stopped {name}")


def main() -> None:
    busy = [p for p in (WEB_PORT, ENGINE_PORT, COGNITO_PORT, COGNITO_PORT + 1) if not port_free(p)]
    if busy:
        sys.exit(f"Ports already in use: {busy}. Is another dev environment running?")
    prepare()
    DEV.mkdir(exist_ok=True)
    if not OUTPUTS.exists():  # gitignored; left in place so a verification instance can share it
        OUTPUTS.write_text(json.dumps(PLACEHOLDER_OUTPUTS, indent=2), encoding="utf-8")

    stack = Stack()
    try:
        cognito_json = DEV / "cognito.json"
        cognito_json.unlink(missing_ok=True)
        stack.start("cognito", [*uv(), "run", "-q", "--python", "3.12", "--with", "moto[server]", "--with", "boto3",
                                "python", str(REPO / "scripts" / "local_cognito.py"), str(cognito_json), str(COGNITO_PORT)],
                    REPO)
        stack.wait_until("cognito", cognito_json.exists, 180)
        cognito = json.loads(cognito_json.read_text(encoding="utf-8"))

        env_file = ["--env-file", str(REPO / ".env")] if (REPO / ".env").exists() else []
        stack.start("engine", [*uv(), "run", *env_file, "ocr", "serve", "--port", str(ENGINE_PORT), "--reload"],
                    REPO / "engines", {"OCR_CORS_ORIGINS": WEB_URL})
        stack.wait_until("engine", lambda: get(f"{ENGINE_URL}/engines")[0] == 200, 120)

        stack.start("web", [tool("npx"), "next", "dev", "-p", str(WEB_PORT)], REPO / "web", {
            "NEXT_PUBLIC_OCR_API_URL": ENGINE_URL,
            "NEXT_PUBLIC_COGNITO_ENDPOINT": cognito["endpoint"],
            "NEXT_PUBLIC_COGNITO_USER_POOL_ID": cognito["user_pool_id"],
            "NEXT_PUBLIC_COGNITO_CLIENT_ID": cognito["client_id"],
        })
        stack.wait_until("web", lambda: b"<title>OCR Playground</title>" in get(WEB_URL)[1], 180)

        print(f"\nDev environment up at {WEB_URL}  (engine API {ENGINE_URL}, Cognito {cognito['endpoint']})")
        print(f"Sign in as {cognito['email']} / {cognito['password']}. Ctrl+C stops everything.\n", flush=True)
        while (name := stack.exited()) is None:
            time.sleep(1)
        print(f"\n{name} exited with code {stack.procs[name].returncode}; stopping the rest")
    except KeyboardInterrupt:
        print("\nStopping")
    except RuntimeError as err:
        print(f"\n{err}; stopping the rest")
    finally:
        stack.stop()


if __name__ == "__main__":
    main()
