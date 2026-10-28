#!/usr/bin/env bash
# Cloud-init for the Suite host: everything an instance needs before a checkout exists.
#
# This runs once, as root, from the instance's user-data. It installs the tools the runbook
# assumes (Docker from Docker's own repository, `sqlite3`, the AWS CLI for backups and
# metrics, Tailscale for SSH and the operator door), creates a swap file for the on-host
# build, and stops short of the destructive half: formatting the data volume and cloning the
# repository are steps a person runs, because both are decisions rather than setup.
#
# Passed as `--user-data file://deploy/user-data.sh` when the instance is launched.
#
# What it deliberately does not do:
#
# - open a firewall port. The security group is the firewall; the host runs none, which is
#   one fewer place for a rule to disagree with AWS.
# - configure Tailscale. `tailscale up` prints a login URL that a person clicks, and an
#   auth key baked into user-data is a credential in the instance metadata forever.
# - touch the data volume. `mkfs` on the wrong device is the one mistake this file will not
#   make on its own.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git jq unzip sqlite3 rsync \
  unattended-upgrades chrony

# Docker from Docker's repository, not the distribution package: the compose plugin, the
# `awslogs` driver and the ip6tables behaviour are all versioned there.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.list <<DOCKER
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable
DOCKER
apt-get update
apt-get install -y --no-install-recommends \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# The AWS CLI: `deploy/backup.sh` uploads with it and `deploy/alert.sh --cloudwatch`
# publishes with it. The package manager's version is v1, whose `s3 cp` options differ.
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install --update && rm -rf /tmp/aws /tmp/awscliv2.zip

# Tailscale is how SSH and `/admin` arrive, which is why the security group has no port 22.
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list
apt-get update
apt-get install -y --no-install-recommends tailscale

# A 4 GB build on 2 GB of RAM is the documented failure mode; 2 GB of swap turns an OOM kill
# into a slow build.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  printf '/swapfile none swap sw 0 0\n' >>/etc/fstab
fi

# Security patches only, and only what does not need a reboot loop at 3am.
cat >/etc/apt/apt.conf.d/20auto-upgrades <<UPGRADES
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
UPGRADES

# The runtime user. Docker access is root-equivalent, so it is the same account the deploy
# runs as rather than a wider group of people.
id -u suite >/dev/null 2>&1 || useradd -m -s /bin/bash suite
usermod -aG docker suite
install -d -o suite -g suite /srv
install -d -o suite -g suite /srv/backups

systemctl enable --now docker
apt-get clean

printf 'suite host ready: docker, sqlite3, aws, tailscale, 2 GB swap\n' >/var/log/suite-user-data.log
printf 'next: mount the data volume, clone the repo into /srv/suite, run tailscale up --ssh\n' \
  >>/var/log/suite-user-data.log
