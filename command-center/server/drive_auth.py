"""One-time Google consent for the private Drive bridge.

Prints an OAuth URL for caseylsims@gmail.com, then exchanges a code for a
refresh token. The token is printed to this terminal only. Nothing is written
into the repo, and the client secret is never printed.

    GOOGLE_DRIVE_CLIENT_ID=... GOOGLE_DRIVE_CLIENT_SECRET=... python3 server/drive_auth.py
    GOOGLE_DRIVE_CLIENT_ID=... GOOGLE_DRIVE_CLIENT_SECRET=... python3 server/drive_auth.py --code 'CODE'
"""

from __future__ import annotations

import argparse
import sys

import drive_api


def main() -> None:
    parser = argparse.ArgumentParser(description="Consent to Google Drive for the private bridge.")
    parser.add_argument("--code", default="", help="Authorization code from the browser redirect.")
    args = parser.parse_args()
    client_id = drive_api.env_value("GOOGLE_DRIVE_CLIENT_ID")
    client_secret = drive_api.env_value("GOOGLE_DRIVE_CLIENT_SECRET")
    if not client_id or not client_secret:
        print(
            "Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in the environment first. "
            "Create an OAuth desktop client in Google Cloud, enable the Google Drive API, "
            f"and add redirect URI {drive_api.AUTH_REDIRECT}",
            file=sys.stderr,
        )
        raise SystemExit(1)
    if not args.code:
        print(drive_api.consent_url(client_id))
        print(
            f"Open that URL as {drive_api.ACCOUNT}. After Google redirects to {drive_api.AUTH_REDIRECT}, "
            "copy the code parameter and run this script again with --code.",
            file=sys.stderr,
        )
        return
    token = drive_api.exchange_code(client_id, client_secret, args.code.strip())
    print(f"GOOGLE_DRIVE_REFRESH_TOKEN={token}")
    print("Put that in the private Drive server environment. Do not commit it.", file=sys.stderr)


if __name__ == "__main__":
    main()
