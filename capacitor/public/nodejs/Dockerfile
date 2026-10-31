# Pin node to match capacitor-nodejs.
FROM node:24.22.1-bookworm-slim AS node

FROM saschpe/android-ndk:35-jdk21.0.6_7-ndk26.3.11579264-cmake3.31.1

USER root

ENV LIBNODE_PATH=/opt/libnode

COPY --from=node /usr/local/ /usr/local/

RUN apt-get update && apt-get install -y \
    ca-certificates \
    make \
    python3 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable pnpm \
    && corepack install --global pnpm@10.34.1 \
    && pnpm config set store-dir /pnpm/store

# Reuse libnode from the existing capacitor-nodejs package.
COPY --from=libnode / /opt/libnode/

WORKDIR /app