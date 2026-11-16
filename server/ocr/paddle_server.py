# -*- coding: utf-8 -*-
"""
PaddleOCR 自托管 HTTP 服务(免费 OCR 方案,见 docs/COSTS.md)。

接口契约(与 server/src/ai/ocr.js 适配器一致):
  POST /ocr  body: {"images": ["<base64>", ...]}
  响应: {"results": [
    {"words": [{"text": "...", "confidence": 0.98,
                "box": [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]}, ...],
     "error": null}
  ]}

运行:
  pip install -r requirements.txt
  uvicorn paddle_server:app --host 0.0.0.0 --port 8788
或直接: python paddle_server.py
"""

import base64
import io
import logging
import os

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
import uvicorn

logging.getLogger("ppocr").setLevel(logging.ERROR)

app = FastAPI(title="snaptask-paddleocr")

# 模型懒加载(首次请求初始化,约 10-30 秒;CPU 慢,GPU 快)
_ocr = None


def get_ocr():
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR  # 延迟导入,加快启动

        _ocr = PaddleOCR(
            use_angle_cls=True,
            lang="ch",
            show_log=False,
            use_gpu=bool(os.environ.get("USE_GPU", "")),
        )
    return _ocr


class OcrRequest(BaseModel):
    images: list[str]


def _run(img_bytes: bytes):
    ocr = get_ocr()
    image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    arr = np.array(image)
    result = ocr.ocr(arr, cls=True)
    words = []
    for page in result or []:
        for line in page or []:
            # paddleocr 行格式: [四点框, (text, confidence)]
            try:
                box, (text, conf) = line
                words.append(
                    {
                        "text": str(text),
                        "confidence": float(conf),
                        "box": [[float(p[0]), float(p[1])] for p in box],
                    }
                )
            except Exception:
                continue
    return {"words": words, "error": None}


@app.get("/health")
def health():
    return {"ok": True, "service": "snaptask-paddleocr", "loaded": _ocr is not None}


@app.post("/ocr")
def ocr(req: OcrRequest):
    if not req.images:
        raise HTTPException(status_code=400, detail="images 不能为空")
    results = []
    for b64 in req.images:
        try:
            raw = base64.b64decode(b64)
            results.append(_run(raw))
        except Exception as exc:  # 单图失败不影响其他图
            results.append({"words": [], "error": str(exc)})
    return {"results": results}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8788")))
