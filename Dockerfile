FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements-api.txt ./
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements-api.txt
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV PYTHON_BIN=/opt/venv/bin/python HOST=0.0.0.0 DATA_DIR=/app/data P1_API_URL=http://127.0.0.1:8765
EXPOSE 3000
CMD ["./run-container.sh"]
