#!/usr/bin/env bash
# Creates the GCP resources for the demo: a static IP, a firewall rule for
# HTTP/HTTPS, and one VM that runs docker-compose.yml (see startup.sh).
#
#   deploy/gcp/vm-setup.sh                 # gcloud's default project, region and zone
#   ZONE=asia-south1-c deploy/gcp/vm-setup.sh
#
# The site comes up at https://<ip-with-dashes>.sslip.io, so no domain is
# needed. Set PUBLIC_URL to use your own (point its DNS at the IP first).
set -euo pipefail
cd "$(dirname "$0")"

ZONE="${ZONE:-$(gcloud config get-value compute/zone 2>/dev/null)}"
ZONE="${ZONE:-asia-south1-c}"
REGION="${ZONE%-*}"
NAME="${NAME:-graph-hacks}"
MACHINE="${MACHINE:-e2-standard-2}"
BRANCH="${BRANCH:-main}"
REPO_URL="${REPO_URL:-https://github.com/Sky-walkerX/graph-hacks.git}"

gcloud services enable compute.googleapis.com

if ! gcloud compute addresses describe "$NAME-ip" --region "$REGION" >/dev/null 2>&1; then
  gcloud compute addresses create "$NAME-ip" --region "$REGION"
fi
IP="$(gcloud compute addresses describe "$NAME-ip" --region "$REGION" --format 'value(address)')"
PUBLIC_URL="${PUBLIC_URL:-https://${IP//./-}.sslip.io}"

if ! gcloud compute firewall-rules describe "$NAME-web" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "$NAME-web" \
    --allow tcp:80,tcp:443,udp:443 --target-tags "$NAME" \
    --description "HTTP/HTTPS to the Graph Hacks demo"
fi

gcloud compute instances create "$NAME" \
  --zone "$ZONE" \
  --machine-type "$MACHINE" \
  --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
  --boot-disk-size 40GB --boot-disk-type pd-balanced \
  --address "$IP" \
  --tags "$NAME" \
  --metadata-from-file startup-script=startup.sh \
  --metadata "repo-url=$REPO_URL,repo-branch=$BRANCH,public-url=$PUBLIC_URL"

echo
echo "VM $NAME is booting. The first build takes about 10 minutes."
echo "Follow it:  gcloud compute ssh $NAME --zone $ZONE -- sudo journalctl -u google-startup-scripts -f"
echo "Then open:  $PUBLIC_URL"
