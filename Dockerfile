FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
