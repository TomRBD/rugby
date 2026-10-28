# Image GPU (CUDA) pour une instance à la demande (Scaleway GPU, OVHcloud AI Deploy)
FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgl1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY service.py .
ENV MODELE=yolo11m.pt PORT=8000
EXPOSE 8000
CMD ["python", "service.py"]
