# Playwright's own image ships the browsers but not the npm package, so add just
# the matching library. Browsers already live in /ms-playwright, so the install
# script's download is skipped.
#
# The package is reachable as /node_modules because Node's ESM resolver walks up
# from the importing file (/tests/render.mjs) to /node_modules — it ignores
# NODE_PATH and global installs. npm itself refuses to install with the cwd set
# to /, so install in /opt and symlink.
ARG PLAYWRIGHT_VERSION=1.62.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
ARG PLAYWRIGHT_VERSION
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /opt/render
RUN npm init -y >/dev/null \
    && npm install --no-audit --no-fund "playwright@${PLAYWRIGHT_VERSION}" \
    && ln -s /opt/render/node_modules /node_modules
WORKDIR /tests
