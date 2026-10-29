#!/bin/bash
# OpenCartridge container entrypoint:
#   1. MinIO (shared storage for all worker containers) on :9000/:9001
#   2. public `tost` + `test` buckets, anonymous read/write
#   3. the OpenCartridge UI on :3000 — restarted by the loop after
#      POST /api/update pulls and rebuilds a newer version.
set -u

/usr/local/bin/minio server /content/data --console-address :9001 &
MINIO_PID=$!

until wget -qO- http://localhost:9000/minio/health/live > /dev/null 2>&1; do
  sleep 1
done

/usr/local/bin/mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
/usr/local/bin/mc mb --ignore-existing local/tost
/usr/local/bin/mc anonymous set public local/tost
/usr/local/bin/mc mb --ignore-existing local/test
/usr/local/bin/mc anonymous set public local/test
echo "[OpenCartridge] buckets 'tost' and 'test' ready (anonymous read/write)"

while true; do
  cd /app/OpenCartridge
  pnpm start --port 3000 --hostname 0.0.0.0
  echo "[OpenCartridge] server exited — restarting in 2s (self-update re-execs here)"
  sleep 2
done
