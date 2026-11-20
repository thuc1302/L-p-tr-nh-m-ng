#!/bin/sh
# Tao chung chi HTTPS tu ky cho localhost va IP mang LAN hien tai.
# IP do dich vu lan-watch ghi vao /run/chatly/lan_host; chi tao lai khi IP doi.
set -e
DIR=/etc/nginx/certs
LAN_IP=$(cat /run/chatly/lan_host 2>/dev/null || true)
HOSTS="localhost 127.0.0.1 $LAN_IP"
mkdir -p "$DIR"
if [ -s "$DIR/chatly.crt" ] && [ "$(cat "$DIR/hosts" 2>/dev/null)" = "$HOSTS" ]; then
  exit 0
fi
SAN=""
for h in $HOSTS; do
  case "$h" in
    *[!0-9.]*) SAN="$SAN,DNS:$h" ;;
    *) SAN="$SAN,IP:$h" ;;
  esac
done
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=Chatly" \
  -addext "subjectAltName=${SAN#,}" \
  -keyout "$DIR/chatly.key" -out "$DIR/chatly.crt" 2>/dev/null
echo "$HOSTS" > "$DIR/hosts"
echo "Chatly: da tao chung chi HTTPS cho: $HOSTS"
