# Deploying on GCP

The whole stack in `docker-compose.yml` runs on one Compute Engine VM: LockIn, Postgres, FalkorDB, and Caddy for HTTPS. The deployed demo and a local `docker compose up` are the same stack.

```sh
gcloud auth login
gcloud config set project <project-id>
gcloud config set compute/zone asia-south1-c   # optional; this is the default
deploy/gcp/vm-setup.sh
```

`vm-setup.sh` creates:

| Resource | Name | Notes |
|---|---|---|
| Static external IP | `graph-hacks-ip` | Kept across VM restarts and rebuilds |
| Firewall rule | `graph-hacks-web` | TCP 80 and 443, UDP 443, for VMs tagged `graph-hacks` |
| VM | `graph-hacks` | `e2-standard-2`, Ubuntu 24.04, 40 GB disk |

The VM's startup script (`startup.sh`) runs at every boot. It installs Docker, clones or updates the repository in `/opt/graph-hacks`, writes `.env` on the first run with a random `AUTH_SECRET` and Postgres password, then runs `docker compose --profile https up -d --build`.

The site is served at `https://<ip-with-dashes>.sslip.io`, so no domain is needed. Caddy gets the certificate from Let's Encrypt. To use your own domain, point its DNS at the IP and run `PUBLIC_URL=https://your.domain deploy/gcp/vm-setup.sh` instead.

The first boot takes about 10 minutes, mostly for the Next build. To follow it:

```sh
gcloud compute ssh graph-hacks -- sudo journalctl -u google-startup-scripts -f
```

## Settings

`vm-setup.sh` reads these from the environment:

| Variable | Default |
|---|---|
| `ZONE` | gcloud's `compute/zone`, else `asia-south1-c` |
| `NAME` | `graph-hacks` (VM, IP, firewall rule and network tag) |
| `MACHINE` | `e2-standard-2` |
| `BRANCH` | `main` |
| `REPO_URL` | `https://github.com/Sky-walkerX/graph-hacks.git` |
| `PUBLIC_URL` | `https://<ip-with-dashes>.sslip.io` |

To change other settings, edit `/opt/graph-hacks/.env` on the VM, then redeploy.

## Redeploying

After pushing to the deployed branch:

```sh
deploy/gcp/redeploy.sh
```

This reruns the startup script on the VM, which pulls the branch and rebuilds.

## Looking at the graph

FalkorDB and FalkorDB Browser listen on the VM itself only. To open the Browser from your machine:

```sh
gcloud compute ssh graph-hacks -- -L 3001:127.0.0.1:3001
# then open http://localhost:3001 and connect to localhost:6379
```

## Removing everything

```sh
gcloud compute instances delete graph-hacks
gcloud compute firewall-rules delete graph-hacks-web
gcloud compute addresses delete graph-hacks-ip --region asia-south1
```
