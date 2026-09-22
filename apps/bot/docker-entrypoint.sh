#!/bin/sh
# Hugging Face and Railway both start the bot from this image.
# Persistent files belong under DATA_DIR (default /data). The directory is
# created when the mount is writable. Missing storage does not enable live trading.
set -eu
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/logs/days" "$DATA_DIR/exports" || true
exec npm run start -w @snipr/bot
