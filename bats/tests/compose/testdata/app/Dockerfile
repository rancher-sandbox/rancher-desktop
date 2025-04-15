ARG IMAGE_PYTHON=python:3.9-slim
FROM ${IMAGE_PYTHON}

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "app.py"]
