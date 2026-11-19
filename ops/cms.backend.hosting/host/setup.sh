#!/bin/sh
# Sets up a server for cms.backend.hosting, again on every update: installs the root helper and turns on
# automatic updates from every package source, rebooting at night when one needs it. Run as root from here:
#   sh setup.sh <managing instance> [preview domain]
set -eu
manager=$1 preview=${2:-}
cd "$(dirname "$0")"

lib=/usr/local/lib/qino-hosting
mkdir -p $lib
rm -rf $lib/templates
cp -r helper.ts templates $lib/
chown -R root: $lib && chmod -R go-w $lib
sed -e "s/<manager>/$manager/" -e "s/<preview domain>/$preview/" qino-hosting.service |
  if [ -n "$preview" ]; then cat; else grep -v HOSTING_PREVIEW; fi > /etc/systemd/system/qino-hosting.service
systemctl daemon-reload
systemctl enable qino-hosting
systemctl restart qino-hosting

if command -v apt-get >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get -qy install unattended-upgrades
  cat > /etc/apt/apt.conf.d/52qino-hosting <<'EOF'
// written by cms.backend.hosting/host/setup.sh
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
Unattended-Upgrade::Origins-Pattern { "origin=*"; };
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
Dpkg::Options { "--force-confdef"; "--force-confold"; };
EOF
elif command -v dnf >/dev/null; then
  dnf -qy install dnf-automatic
  sed -i -e 's/^apply_updates.*/apply_updates = yes/' -e 's/^upgrade_type.*/upgrade_type = default/' /etc/dnf/automatic.conf
  systemctl enable --now dnf-automatic.timer
  # dnf-automatic does not reboot on every release: a timer that reboots at night when one is needed
  cat > /etc/systemd/system/qino-hosting-reboot.service <<'EOF'
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'needs-restarting -r >/dev/null || systemctl reboot'
EOF
  cat > /etc/systemd/system/qino-hosting-reboot.timer <<'EOF'
[Timer]
OnCalendar=*-*-* 03:30
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now qino-hosting-reboot.timer
fi
