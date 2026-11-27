#!/bin/sh
set -eu
test "$(wc -c < /tmp/atlas-vault-selected)" -eq 64
cat /tmp/atlas-vault-selected
printf "\n"
