#!/usr/bin/env bash
# Pulls the latest commit of the deployed branch on the VM and rebuilds.
set -euo pipefail

ZONE="${ZONE:-$(gcloud config get-value compute/zone 2>/dev/null)}"
NAME="${NAME:-graph-hacks}"

gcloud compute ssh "$NAME" --zone "${ZONE:-asia-south1-c}" -- \
  'sudo google_metadata_script_runner startup'
