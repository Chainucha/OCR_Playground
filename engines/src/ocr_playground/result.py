from dataclasses import asdict, dataclass, field
from typing import Literal

Box = list[list[float]]


@dataclass
class Line:
    text: str
    confidence: float | None = None
    box: Box | None = None


@dataclass
class OcrResult:
    engine: str
    text: str
    format: Literal["text", "markdown"]
    latency_ms: float
    lines: list[Line] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
