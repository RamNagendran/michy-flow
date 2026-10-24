# API image. Bill reading needs two system libraries OpenCV links against (libGL, glib),
# which plain Python hosts often lack; this image includes them.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .

# Never run as root.
RUN useradd --create-home --uid 10001 app && chown -R app /app
USER app

EXPOSE 8000
# --proxy-headers so audit logs record the real client IP behind Render's proxy.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
