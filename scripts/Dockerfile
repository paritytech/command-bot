FROM docker.io/node:16.13.2-bullseye-slim as base

ENV DEBIAN_FRONTEND=noninteractive

# for downloading shfmt: wget ca-certificates
# Needed for building RocksDB bindings for Node.js: build-essential python3
# Git is needed for both pre-commit and also for cloning repositories before
# running the bot's commands
RUN apt-get update && \
    apt-get install -y --quiet --no-install-recommends \
    wget ca-certificates \
    build-essential python3 \
    git && \
    git --version \
    # shfmt is needed for shell command parsing
    wget https://github.com/mvdan/sh/releases/download/v3.5.0/shfmt_v3.5.0_linux_amd64 -O /bin/shfmt && \
    echo "8feea043364a725dfb69665432aee9e85b84c7f801a70668650e8b15452f6574  /bin/shfmt" | sha256sum --check && \
    chmod +x /bin/shfmt && \
    shfmt --version && \
    git config --global user.name command-bot && \
    git config --global user.email "opstooling+commandbot@parity.io"

# ---------------------- build ---------------------- #

FROM base as builder

COPY . /build
WORKDIR /build
RUN yarn --ignore-optional --immutable

# ---------------------- app ---------------------- #

FROM builder AS app

WORKDIR /app

COPY --from=builder /build/ /app

RUN chown -R node:node /app

CMD yarn start

# ---------------------- ci ---------------------- #

FROM base AS ci

# CI pipeline utilities
# python3-* is needed for pre-commit
RUN apt-get install -y --quiet --no-install-recommends \
    python3 \
    make \
    bash \
    sed \
    python3-distutils \
    python3-pkg-resources \
    gcc \
    python3-dev \
    libc-dev \
    python3-pip && \
    pip3 install pre-commit && \
    pre-commit --version && \
    apt-get autoremove -y
