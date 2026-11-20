#!/bin/sh
# Chay trong container dung chung mang voi may chu (network_mode: host).
# Cu 5 giay doc IP mang LAN dang dung va ghi vao /run/chatly/lan_host khi IP thay doi.
FILE=/run/chatly/lan_host
while true; do
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')
  if [ -n "$ip" ] && [ "$ip" != "$(cat "$FILE" 2>/dev/null)" ]; then
    echo "$ip" > "$FILE.tmp" && mv "$FILE.tmp" "$FILE"
    echo "$(date '+%H:%M:%S') IP mang LAN: $ip"
  fi
  sleep 5
done
