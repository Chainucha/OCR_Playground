from dataclasses import dataclass, field
from typing import Literal

Align = Literal["left", "right", "center"]
Rect = tuple[float, float, float, float]


@dataclass(frozen=True)
class Cell:
    text: str
    x: float
    """Anchor as a fraction of the content width: left edge, right edge, or centre, per `align`."""
    align: Align = "left"
    underline: bool = False


@dataclass(frozen=True)
class Row:
    """One line on the page and one line of ground truth."""

    cells: tuple[Cell, ...]
    size: float = 1.0
    bold: bool = False
    space_before: float = 0.0
    rule_below: bool = False


@dataclass
class Document:
    kind: str
    rows: list[Row]
    width: int
    height: int | None = None
    """None sizes the page to its content."""
    margin: int = 90
    font_px: int = 30
    paper: tuple[int, int, int] = (255, 255, 255)
    boxes: list[Rect] = field(default_factory=list)
    """Outlined rectangles (photo placeholders, card frames) as fractions of the page."""

    def ground_truth(self) -> str:
        lines = (" ".join(c.text for c in row.cells if c.text) for row in self.rows)
        return "\n".join(line for line in lines if line) + "\n"


def row(*cells: Cell, **kwargs) -> Row:
    return Row(tuple(cells), **kwargs)
