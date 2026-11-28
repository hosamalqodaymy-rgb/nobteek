FROM node:24-bookworm-slim AS frontend
WORKDIR /src
COPY application application
COPY design design
WORKDIR /src/application
RUN npm ci --no-audit --no-fund && npm run build

FROM composer:2 AS composer

FROM php:8.4-apache-trixie
RUN apt-get update && apt-get install -y --no-install-recommends \
        libicu-dev libpq-dev libzip-dev postgresql-17 unzip \
    && docker-php-ext-install -j2 pdo_pgsql intl zip \
    && a2enmod rewrite headers setenvif \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
WORKDIR /srv/nobteek
COPY application application
COPY design design
COPY android-preview/dhamar/web android-preview/dhamar/web
COPY tools/prepare_connected_preview.php tools/prepare_p06_browser.php tools/prepare_p08_browser.php tools/prepare_p12_browser.php tools/
COPY --from=frontend /src/application/public/build application/public/build
WORKDIR /srv/nobteek/application
RUN COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader \
    && install -d -o www-data -g www-data /srv/nobteek/results \
    && chown -R www-data:www-data storage bootstrap/cache
COPY deploy/connected-qa/apache.conf /etc/apache2/sites-available/000-default.conf
COPY deploy/connected-qa/start.sh /usr/local/bin/nobteek-connected-start
EXPOSE 10000
CMD ["bash", "/usr/local/bin/nobteek-connected-start"]
