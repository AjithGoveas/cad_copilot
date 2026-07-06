# Stage 1: Base stage with dependencies and system packages
FROM python:3.13.5-slim AS base

# Install headless graphics libraries required by OpenCASCADE (OCP)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create directories for outputs and logs
RUN mkdir -p /app/outputs /app/logs

# Create a non-root user and set permissions
RUN useradd -u 1001 appuser && chown -R appuser:appuser /app
USER appuser

# Stage 2: Development environment (supports hot-reloading)
FROM base AS development
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# Stage 3: Production environment (pre-baked source code)
FROM base AS production
COPY --chown=appuser:appuser app/ app/
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
