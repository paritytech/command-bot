#!/usr/bin/env bash

timestamp=$(date +%s)

# remember initial branch
dev_branch=$(git rev-parse --abbrev-ref HEAD)

# replace possible "/" with "-"
# Because of a docker, as it uses git tag for tagging the image so if there's a / symbol
# docker thinks that it's actually a path. but not part of the tag name.
dev_branch_sanitized=${dev_branch/\//-}

stg_branch="stg-v0.0.${timestamp}-${dev_branch_sanitized}"

git push origin HEAD:"$stg_branch"

# wait a bit before deleting branch, so gitlab triggers pipeline
sleep 10

git push origin --delete "$stg_branch"
