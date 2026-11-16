# PaddleOCR 自托管服务镜像(CPU 版)。
# 构建: docker build -t snaptask-paddleocr -f server/ocr/Dockerfile server/ocr
# GPU 加速:改用 paddlepaddle-gpu 并挂载 nvidia runtime,见 docs/COSTS.md。
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
# 先装依赖(利用构建缓存),再拷贝服务代码
RUN pip install --no-cache-dir -r requirements.txt

COPY paddle_server.py ./

ENV PORT=8788
EXPOSE 8788

CMD ["python", "paddle_server.py"]
