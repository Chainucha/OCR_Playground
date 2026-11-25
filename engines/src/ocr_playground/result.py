from dataclasses import asdict, dataclass, field
from typing import Literal

Box = list[list[float]]


@dataclass
class Line:
    text: str
    confidence: float | None = None
    box: Box | None = None


@dataclass
class Stage:
    """One step of a run and how long it took. A result's stages don't overlap, so they add up to its latency."""

    name: str
    ms: float


@dataclass
class OcrResult:
    engine: str
    text: str
    format: Literal["text", "markdown"]
    latency_ms: float
    lines: list[Line] = field(default_factory=list)
    # Empty when the engine can't say where its time went.
    stages: list[Stage] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
