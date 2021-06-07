FROM docker.io/node:current-alpine3.12

ARG REPO_VOLUME
ENV REPO_DIR=$REPO_VOLUME
RUN if [ ! "$REPO_DIR" ]; then exit 1; fi

RUN apk update

# Git is needed for cloning the repositories
RUN apk add --no-cache git && git --version

# Rust is needed for running the bot's commands
RUN apk add --update --no-cache \
  --repository=http://dl-cdn.alpinelinux.org/alpine/edge/main \
  cargo rust

# Needed for building RocksDB
RUN apk add --no-cache \
  --virtual .rocksdb-build-deps \
  linux-headers python3 make gcc libc-dev g++

ENV NODE_ENV=PRODUCTION

RUN cd "$REPO_DIR" && \
  npm ci && \
  npm run build && \
  mkdir /bot && \
  mv build node_modules /bot

RUN apk del .rocksdb-build-deps

WORKDIR /bot

CMD node ./build/main.js
