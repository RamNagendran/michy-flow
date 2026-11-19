#!/bin/sh
# One-time setup of a fresh Ubuntu 24.04 server. Run as root:  sh server-setup.sh
set -eu

apt-get update && apt-get -y upgrade
apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades
curl -fsSL https://get.docker.com | sh

# Deploy user (GitHub Actions logs in as this user with an SSH key).
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh /opt/michy-flow/backups
cp /root/.ssh/authorized_keys /home/deploy/.ssh/ 2>/dev/null || true
chown -R deploy:deploy /home/deploy/.ssh /opt/michy-flow
chmod 700 /home/deploy/.ssh

# Firewall: SSH and web only. Postgres is never exposed.
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# Key-only SSH, no root login.
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# 2 GB swap as a cushion for OCR peaks.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
fi

timedatectl set-timezone Asia/Kolkata
echo "Done. Add your key to /home/deploy/.ssh/authorized_keys, then log in as deploy."
