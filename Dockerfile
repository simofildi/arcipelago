# One image for every service: islands, collector and dashboard are the same
# container started with different commands. One build, one surface to verify.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/src

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ /app/src/
RUN mkdir -p /app/output

# Default: one island. docker-compose.yml overrides with the collector or dashboard.
CMD ["python", "-m", "archipelago.island"]
