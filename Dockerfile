FROM docker.io/node:18-bullseye-slim as base

ENV DEBIAN_FRONTEND=noninteractive

# for downloading shfmt: wget ca-certificates
# Needed for building RocksDB bindings for Node.js: build-essential python3
# Git is needed for cloning repositories before
# running the bot's commands
RUN apt-get update && \
    apt-get install -y --quiet --no-install-recommends \
    wget ca-certificates \
    build-essential python3 \
    git && \
    git --version && \
    # shfmt is needed for shell command parsing
    wget https://github.com/mvdan/sh/releases/download/v3.5.0/shfmt_v3.5.0_linux_amd64 -O /bin/shfmt && \
    echo "8feea043364a725dfb69665432aee9e85b84c7f801a70668650e8b15452f6574  /bin/shfmt" | sha256sum --check && \
    chmod +x /bin/shfmt && \
    shfmt --version && \
    git config --global user.name command-bot && \
    git config --global user.email "opstooling+commandbot@parity.io"

COPY . /builder
WORKDIR /builder
RUN yarn --ignore-optional --frozen-lockfile && yarn build

# ---------------------- app ---------------------- #

FROM base AS app

WORKDIR /app

COPY --from=base /builder/ /app

RUN chown -R node:node /app

CMD yarn start
