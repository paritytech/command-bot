#!/usr/bin/env bash

timestamp=$(date +%s)

# remember initial branch
dev_branch=$(git rev-parse --abbrev-ref HEAD)

# replace possible "/" with "-"
dev_branch_sanitized=${dev_branch/\//-}

stg_branch="stg-v0.0.${timestamp}-${dev_branch_sanitized}"

git checkout -b "$stg_branch"
git push origin "$stg_branch"

# wait a bit before deleting branch, so gitlab triggers pipeline
sleep 10

git push origin --delete "$stg_branch"

# get back to initial branch
git checkout "$dev_branch"
