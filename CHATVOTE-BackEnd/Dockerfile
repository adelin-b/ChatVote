# SPDX-FileCopyrightText: 2025 chatvote
#
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

# ── Stage 1: Build (compile C extensions, export deps) ──────────────
FROM python:3.11.3-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip setuptools wheel && \
    pip install poetry && \
    poetry self add poetry-plugin-export

COPY pyproject.toml poetry.lock /app/
WORKDIR /app

# Export pinned requirements from lockfile
RUN poetry export --only main --without-hashes -f requirements.txt -o requirements.txt

# Install CPU-only PyTorch first (skip CUDA — saves ~4GB in image)
# Override with: docker build --build-arg TORCH_VARIANT=gpu .
ARG TORCH_VARIANT=cpu
RUN if [ "$TORCH_VARIANT" = "gpu" ]; then \
      echo "Installing GPU-enabled PyTorch"; \
      pip install --prefix=/install torch; \
    else \
      echo "Installing CPU-only PyTorch (~200MB vs ~2GB)"; \
      pip install --prefix=/install torch --index-url https://download.pytorch.org/whl/cpu; \
    fi

# Install remaining deps (exclude torch* and nvidia* since torch is already installed)
RUN grep -v -E '^(torch|nvidia|triton)' requirements.txt > requirements-no-torch.txt && \
    pip install --prefix=/install -r requirements-no-torch.txt

# ── Stage 2: Runtime (slim, no build tools) ─────────────────────────
FROM python:3.11.3-slim

# Playwright runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from builder
COPY --from=builder /install/lib /usr/local/lib
COPY --from=builder /install/bin /usr/local/bin

# Install Playwright browsers (Chromium only for smaller image)
RUN playwright install chromium && playwright install-deps chromium

WORKDIR /app

# Copy application code
COPY . /app

CMD ["python", "-m", "src.aiohttp_app", "--host", "0.0.0.0", "--port", "8080"]

