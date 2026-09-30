FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install --prefer-offline
COPY . .

# Accept API URLs as build-time args (CRA bakes REACT_APP_* at build, not runtime)
ARG REACT_APP_API_URL=https://civicai-backend-1063473205796.us-central1.run.app/api
ARG REACT_APP_WS_URL=wss://civicai-backend-1063473205796.us-central1.run.app
ENV REACT_APP_API_URL=$REACT_APP_API_URL
ENV REACT_APP_WS_URL=$REACT_APP_WS_URL

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html

# React Router support — Cloud Run uses PORT=8080
RUN echo 'server { \
  listen 8080; \
  location / { \
    root /usr/share/nginx/html; \
    index index.html; \
    try_files $uri $uri/ /index.html; \
  } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
