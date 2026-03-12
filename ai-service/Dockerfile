# ============================================================
# CivicAI AI Service — Dockerfile
# Supports GPU (CUDA 12.1) and CPU-only deployments
# ============================================================

# Use GPU base if available; fall back to plain Python for CPU
ARG BASE_IMAGE=python:3.11-slim
FROM ${BASE_IMAGE}

# System dependencies (ffmpeg required for Whisper)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    git \
    curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy source (training/ is excluded — only needed for fine-tuning, not runtime)
COPY main.py .

# Model cache directory (mount a volume here to persist downloaded models)
ENV HF_HOME=/app/models
ENV TRANSFORMERS_CACHE=/app/models
RUN mkdir -p /app/models

# Default env — override in docker-compose or .env
ENV MISTRAL_MODEL_ID=mistralai/Mistral-7B-Instruct-v0.3
ENV WHISPER_MODEL_SIZE=base
ENV YOLO_MODEL_PATH=yolov8n.pt
ENV PRELOAD_MISTRAL=true
ENV PRELOAD_YOLO=false
ENV PRELOAD_WHISPER=false

# Run as non-root for security
RUN useradd -m -u 1000 aiuser && chown -R aiuser:aiuser /app
USER aiuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=15s --start-period=120s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
