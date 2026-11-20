#!/bin/sh
# Chay nen: khi IP mang LAN doi thi tao lai chung chi va nap lai nginx, khong ngat ket noi.
(
  last=$(cat /run/chatly/lan_host 2>/dev/null)
  while sleep 5; do
    now=$(cat /run/chatly/lan_host 2>/dev/null)
    if [ "$now" != "$last" ]; then
      last=$now
      /docker-entrypoint.d/10-chatly-cert.sh && nginx -s reload && echo "Chatly: da nap lai nginx cho IP $now"
    fi
  done
) &
