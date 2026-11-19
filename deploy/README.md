# Production deploy

One server, Docker Compose. `DOMAIN` serves the app, `api.DOMAIN` the API, `www.DOMAIN` redirects to the app:

```
browser ──https──▶ web (nginx: TLS, DOMAIN → React app, api.DOMAIN → api:8000 incl. /ws)
                    └─▶ api (FastAPI, 1 process) ──▶ db (Postgres 17, not exposed)
certbot renews TLS every 12 h · backup dumps the database daily at 02:00 IST
```

Push to `main` → GitHub Actions runs tests → builds `api` and `web` images to GHCR (tagged with the
commit SHA) → SSHes in and runs `scripts/deploy.sh <sha>`, which goes back to the previous tag if
`https://api.DOMAIN/health` fails.

## Server

Ubuntu 24.04, **2 vCPU, 4 GB RAM, 80 GB SSD**, in an Indian region (Mumbai / Bangalore).
OCR needs up to ~1 GB while reading two bills, Postgres ~1 GB, the rest is headroom.

## First-time setup

1. Point `A` records for `@`, `www` and `api` at the server IP.
2. As root: `sh server-setup.sh` (copy it from `deploy/scripts/`). Installs Docker, firewall,
   swap, creates the `deploy` user.
3. Make a deploy key on your machine: `ssh-keygen -t ed25519 -f michy_deploy -N ""`. Add
   `michy_deploy.pub` to `/home/deploy/.ssh/authorized_keys`.
4. As `deploy`, in `/opt/michy-flow`: copy `deploy/.env.example` to `.env` and fill it in.
   Copy `docker-compose.prod.yml` and `scripts/` there too (later deploys copy them for you).
5. Get the certificate: `sh scripts/init-letsencrypt.sh you@example.com`
6. GitHub → Settings:
   - **Secrets**: `SSH_HOST`, `SSH_USER` (=`deploy`), `SSH_KEY` (contents of `michy_deploy`),
     `SSH_KNOWN_HOSTS` (output of `ssh-keyscan <server-ip>`).
   - **Variables**: `DOMAIN`.
   - **Environments**: create `production` (add yourself as reviewer if you want a manual OK).
7. Push to `main`. For the very first sign-up set `ALLOW_SIGNUP=true` in `.env`, run
   `sh scripts/deploy.sh <sha>` again, create the Super Admin, then set it back to `false`.

## Everyday

| Task | Command (in `/opt/michy-flow`) |
|---|---|
| Logs | `docker compose -f docker-compose.prod.yml logs -f api` |
| Roll back | `sh scripts/deploy.sh <older-sha>` (only if no migration ran since) |
| DB shell | `docker compose -f docker-compose.prod.yml exec db psql -U michy michy_flow` |
| Restore | `docker compose -f docker-compose.prod.yml exec -T db pg_restore -U michy -d michy_flow --clean < backups/<file>.dump` |

## Backups

Dumps land in `/opt/michy-flow/backups` and are kept 7 days (keep longer history off the server). **Copy them off the server**
(e.g. `rclone` to S3 / Backblaze B2 / Google Drive, daily cron). Bills are stored in the database,
so the dump is the only copy of them. Test a restore once a month.
