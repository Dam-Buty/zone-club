# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./
RUN npm ci

# Copier le code source
COPY . .

# Build argument pour l'URL de l'API
ARG VITE_API_URL
ARG VITE_TMDB_API_KEY

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_TMDB_API_KEY=$VITE_TMDB_API_KEY

# Build de production
RUN npm run build

# Stage 2: Serve avec nginx
FROM nginx:alpine

# Copier la config nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copier les fichiers buildés
COPY --from=builder /app/dist /usr/share/nginx/html

# Exposer le port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
