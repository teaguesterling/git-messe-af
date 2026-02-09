FROM php:8.2-cli

# Install git for storage backend
RUN apt-get update && apt-get install -y git unzip && rm -rf /var/lib/apt/lists/*

# Install composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /app

# Copy composer files first for better caching
COPY composer.json ./
RUN composer install --no-dev --optimize-autoloader

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p data/exchange/state=received data/exchange/state=executing \
    data/exchange/state=finished data/exchange/state=canceled data/executors

# Initialize git repo in data directory
RUN cd data && git init && git config user.email "mess@local" && git config user.name "MESS Server"

# Copy example config
RUN cp config.example.php config.php

EXPOSE 8080

CMD ["php", "-S", "0.0.0.0:8080", "-t", "public"]
