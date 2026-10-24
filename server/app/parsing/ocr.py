"""On-device OCR with RapidOCR (ONNX models bundled in the package: no internet, no AI service).

The engine is loaded once, on first use, and at most a couple of images are read at a time,
so a burst of uploads cannot exhaust the server's memory.
"""

import logging
import threading
from dataclasses import dataclass
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)

_engine: Any = None
_engine_lock = threading.Lock()
# OCR is CPU and memory heavy; two at once keeps a small server responsive.
_slots = threading.BoundedSemaphore(2)
# Long side of the image fed to OCR. Bigger is slower and rarely more accurate for bills.
_MAX_SIDE = 2400


class OcrUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class Box:
    text: str
    left: float
    top: float
    bottom: float
    confidence: float

    @property
    def middle(self) -> float:
        return (self.top + self.bottom) / 2


def _get_engine() -> Any:
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                try:
                    from rapidocr_onnxruntime import RapidOCR
                except ImportError as exc:  # pragma: no cover - depends on the deployment
                    raise OcrUnavailableError("OCR is not installed on this server") from exc
                _engine = RapidOCR()
    return _engine


def _prepare(image: Image.Image) -> Any:
    import numpy as np

    image = image.convert("RGB")
    scale = _MAX_SIDE / max(image.size)
    if scale < 1:
        image = image.resize((round(image.width * scale), round(image.height * scale)))
    return np.asarray(image)[:, :, ::-1]  # RGB → BGR, as OpenCV expects


def group_lines(boxes: list[Box]) -> list[tuple[str, float]]:
    """Rebuild reading order: sort boxes top to bottom, put a box on the current line when its
    middle falls inside that line's height, then read each line left to right. O(n log n)."""
    lines: list[list[Box]] = []
    for box in sorted(boxes, key=lambda b: b.middle):
        current = lines[-1] if lines else None
        if current and current[0].top <= box.middle <= current[0].bottom:
            current.append(box)
        else:
            lines.append([box])
    result = []
    for line in lines:
        ordered = sorted(line, key=lambda b: b.left)
        result.append((" ".join(b.text for b in ordered), min(b.confidence for b in ordered)))
    return result


def read_lines(image: Image.Image) -> list[tuple[str, float]]:
    """Text lines in reading order, each with the lowest word confidence on it (0–1)."""
    engine = _get_engine()
    with _slots:
        result, _ = engine(_prepare(image))
    boxes = []
    for points, text, score in result or []:
        ys = [p[1] for p in points]
        boxes.append(
            Box(
                text=str(text),
                left=min(p[0] for p in points),
                top=min(ys),
                bottom=max(ys),
                confidence=float(score),
            )
        )
    return group_lines(boxes)
