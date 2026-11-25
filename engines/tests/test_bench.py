import csv

from PIL import Image

from ocr_playground.bench import find_samples, run_bench, summarize, write_csv
from ocr_playground.engines import get_engine


def _sample(folder, stem, gt):
    Image.new("RGB", (8, 8), "white").save(folder / f"{stem}.png")
    (folder / f"{stem}.gt.txt").write_text(gt, encoding="utf-8")


def test_bench_scores_each_engine_on_each_sample(tmp_path, fake_registry):
    _sample(tmp_path, "a", "สวัสดีครับ")
    _sample(tmp_path, "b", "สวัสดีครับ")
    Image.new("RGB", (8, 8)).save(tmp_path / "no_ground_truth.png")

    samples = find_samples(tmp_path)
    rows = run_bench(samples, [get_engine("fake-good"), get_engine("fake-bad")])

    assert [s.image.name for s in samples] == ["a.png", "b.png"]
    assert len(rows) == 4
    by_engine = {s["engine"]: s for s in summarize(rows)}
    assert by_engine["fake-good"]["mean_cer"] == 0.0
    assert by_engine["fake-bad"]["mean_cer"] == 0.4

    out = tmp_path / "results" / "run.csv"
    write_csv(rows, out)
    assert len(list(csv.DictReader(out.open(encoding="utf-8")))) == 4


def test_engine_errors_become_rows_not_crashes(tmp_path, fake_registry):
    class Broken:
        name = "broken"

        def run(self, image):
            raise TimeoutError("GX10 did not answer")

    _sample(tmp_path, "a", "x")
    rows = run_bench(find_samples(tmp_path), [Broken()])
    assert rows[0].error == "TimeoutError: GX10 did not answer"
    assert summarize(rows)[0]["errors"] == 1
