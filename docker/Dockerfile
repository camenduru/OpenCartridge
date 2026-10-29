# syntax=docker/dockerfile:1
#
# OpenCartridge — self-contained image (UI + MinIO, cloned from the public repo)
#
# Written in the style of a TostAI studio Dockerfile: ubuntu base, single stage,
# the app cloned from its own repository during the build. Everything is fetched
# during the build; no local folders are needed.
#
#   docker build -t camenduru/OpenCartridge docker/
#
# CACHEBUST IS NOT OPTIONAL IN PRACTICE. BuildKit caches the clone under a key
# that ignores what the branch points at now — without the flag a rebuild
# silently re-serves the first snapshot. Pass:
#
#   --build-arg CACHEBUST=$(date +%s)
#
# A RUNNING CONTAINER CAN ALSO UPDATE ITSELF, with no rebuild: the Global
# Configuration panel has an Update button (POST /api/update) that fetches the
# latest source, rebuilds and re-execs the server via the start script's loop.
#
# MinIO runs INSIDE this container (ports 9000/9001) and creates the public
# `tost` and `test` buckets at startup — the workers point their
# s3_endpoint_url at it and no separate MinIO container is needed.
FROM ubuntu:22.04

WORKDIR /content

ENV DEBIAN_FRONTEND=noninteractive

# System packages, Node 22 + pnpm, git (for the self-update), MinIO + mc
RUN apt update -y && apt install -y curl wget git ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt install -y nodejs && \
    npm install -g pnpm@10 && \
    wget -q https://github.com/minio/minio/releases/download/RELEASE.2025-04-22T22-12-26Z/minio.linux-amd64.RELEASE.2025-04-22T22-12-26Z -O /usr/local/bin/minio && \
    chmod +x /usr/local/bin/minio && \
    wget -q https://github.com/minio/mc/releases/download/RELEASE.2025-08-13T08-35-41Z/mc.linux-amd64.RELEASE.2025-08-13T08-35-41Z -O /usr/local/bin/mc && \
    chmod +x /usr/local/bin/mc && \
    apt clean -y && rm -rf /var/lib/apt/lists/*

# S3 contract shared with the worker containers; MINIO_ROOT_* are the server
# credentials the start script (and boto3 in the workers) authenticate with.
ENV s3_access_key_id=tost \
    s3_secret_access_key=tosttost \
    s3_endpoint_url=http://localhost:9000 \
    s3_region_name=us-east-1 \
    s3_bucket_name=tost \
    s3_bucket_folder=output \
    MINIO_ROOT_USER=tost \
    MINIO_ROOT_PASSWORD=tosttost \
    PORT=3000

# The app — cloned from the public repository. ALWAYS THE LATEST SOURCE at
# build time when CACHEBUST is passed; see the header.
ARG CACHEBUST=0
RUN set -eu; \
    git clone --depth 1 \
      "https://github.com/camenduru/OpenCartridge.git" \
      /app/OpenCartridge; \
    git -C /app/OpenCartridge rev-parse HEAD > /app/OpenCartridge/.update_rev; \
    cd /app/OpenCartridge && \
    pnpm install --frozen-lockfile && \
    pnpm build; \
    echo "cloned camenduru/OpenCartridge at $(cat /app/OpenCartridge/.update_rev)"

COPY start.sh /content/start.sh
RUN chmod +x /content/start.sh

VOLUME /content/data

EXPOSE 3000 9000 9001

CMD ["/content/start.sh"]
