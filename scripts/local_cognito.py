"""Local Cognito for development and verification: moto in-process, one invited user, a CORS proxy in front.

Run through uv so moto and boto3 are available:
    python -m uv run --python 3.12 --with "moto[server]" --with boto3 python scripts/local_cognito.py <out.json> <proxy_port> [<public_host>]

With <public_host> (a LAN IP), the proxy listens on every interface and the endpoint uses that host, so other
machines on the network can sign in. moto itself stays on 127.0.0.1.

Writes {"endpoint", "user_pool_id", "client_id", "email", "password"} to <out.json>, prints READY, and
serves until killed. moto answers CORS preflights from its S3 handler and crashes, so the proxy answers
OPTIONS itself and forwards POSTs to moto.
"""

import json
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import boto3
from moto.server import ThreadedMotoServer

EMAIL = "verify@example.com"
PASSWORD = "Verify-Pass-123!"
FORWARDED_HEADERS = ("Content-Type", "X-Amz-Target", "X-Amz-User-Agent", "Cache-Control")


def seed(moto_url: str) -> tuple[str, str]:
    idp = boto3.client(
        "cognito-idp",
        endpoint_url=moto_url,
        region_name="us-east-1",
        aws_access_key_id="verify",
        aws_secret_access_key="verify",
    )
    pool = idp.create_user_pool(
        PoolName="ocr-playground-verify",
        UsernameAttributes=["email"],
        AutoVerifiedAttributes=["email"],
        AdminCreateUserConfig={"AllowAdminCreateUserOnly": True},
    )["UserPool"]["Id"]
    client = idp.create_user_pool_client(
        UserPoolId=pool,
        ClientName="web",
        ExplicitAuthFlows=["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
    )["UserPoolClient"]["ClientId"]
    idp.admin_create_user(
        UserPoolId=pool,
        Username=EMAIL,
        UserAttributes=[{"Name": "email", "Value": EMAIL}, {"Name": "email_verified", "Value": "true"}],
        MessageAction="SUPPRESS",
    )
    idp.admin_set_user_password(UserPoolId=pool, Username=EMAIL, Password=PASSWORD, Permanent=True)
    return pool, client


def proxy_handler(moto_url: str) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def _cors(self) -> None:
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", self.headers.get("Access-Control-Request-Headers", "*"))
            self.send_header("Access-Control-Max-Age", "600")

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_POST(self) -> None:
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            headers = {h: self.headers[h] for h in FORWARDED_HEADERS if self.headers.get(h)}
            request = urllib.request.Request(moto_url + self.path, data=body, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(request) as upstream:
                    status, payload, ctype = upstream.status, upstream.read(), upstream.headers.get("Content-Type")
            except urllib.error.HTTPError as err:
                status, payload, ctype = err.code, err.read(), err.headers.get("Content-Type")
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", ctype or "application/x-amz-json-1.1")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, fmt: str, *args) -> None:
            sys.stderr.write("cognito-proxy " + fmt % args + "\n")

    return Handler


def main() -> None:
    out_path, proxy_port = sys.argv[1], int(sys.argv[2])
    public_host = sys.argv[3] if len(sys.argv) > 3 else None
    moto_port = proxy_port + 1
    moto = ThreadedMotoServer(ip_address="127.0.0.1", port=moto_port, verbose=False)
    moto.start()
    moto_url = f"http://127.0.0.1:{moto_port}"
    pool, client = seed(moto_url)
    endpoint = f"http://{public_host or '127.0.0.1'}:{proxy_port}"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"endpoint": endpoint, "user_pool_id": pool, "client_id": client, "email": EMAIL, "password": PASSWORD}, f)
    server = ThreadingHTTPServer(("0.0.0.0" if public_host else "127.0.0.1", proxy_port), proxy_handler(moto_url))
    print("READY", endpoint, flush=True)
    try:
        server.serve_forever()
    finally:
        moto.stop()


if __name__ == "__main__":
    main()
