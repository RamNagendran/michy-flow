# Web image: builds the React app and serves it with nginx, which also proxies /api and /ws
# to the API container and terminates TLS.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Baked into the bundle at build time. Must be absolute (https://api.<domain>): the WebSocket
# URL is worked out from it.
ARG VITE_BACKEND_API
ARG VITE_IDLE_LOGOUT_MINUTES=30
ENV VITE_BACKEND_API=$VITE_BACKEND_API VITE_IDLE_LOGOUT_MINUTES=$VITE_IDLE_LOGOUT_MINUTES
RUN npm run build

FROM nginx:1.27-alpine
# The official image runs envsubst on /etc/nginx/templates/*.template at start (${DOMAIN}).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
# Reload every 6 hours so renewed certificates are picked up.
CMD ["sh", "-c", "while :; do sleep 6h; nginx -s reload; done & exec nginx -g 'daemon off;'"]
