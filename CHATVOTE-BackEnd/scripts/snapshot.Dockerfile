FROM python:3.11-slim

RUN pip install --no-cache-dir qdrant-client boto3 urllib3

COPY qdrant_snapshot.py /app/qdrant_snapshot.py
WORKDIR /app

CMD ["python", "qdrant_snapshot.py"]
