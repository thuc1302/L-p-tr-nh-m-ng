FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
RUN apk add --no-cache openssl
# Anh nginx tu chay cac script trong /docker-entrypoint.d truoc khi khoi dong.
COPY --chmod=755 cert.sh /docker-entrypoint.d/10-chatly-cert.sh
COPY --chmod=755 lan-reload.sh /docker-entrypoint.d/20-chatly-lan-reload.sh
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
