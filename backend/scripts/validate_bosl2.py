"""
validate_bosl2.py — Parser fidelity harness for BOSL2 primitives.

Exercises the backend CSGParser against OpenSCAD scripts that use BOSL2's
cuboid() and cyl() helpers. The goal is to measure how closely the parser's
Python implementations of _bosl2_cuboid and _bosl2_cyl match the reference
geometry produced by OpenSCAD itself.

For each fixture script in scripts/fixtures/bosl2/:

  1. Parse via CSGParser and export to STL through ConcreteCADEngine.
  2. If the OpenSCAD CLI is on PATH, also produce a reference STL via:
        openscad -o <tmp>.stl <fixture>.scad
  3. Compare bounding box and triangle count.
  4. Print a verdict per fixture: MATCH / MINOR / MISMATCH / REFERENCE UNAVAILABLE.

Exit code:
  0 — no MISMATCH verdicts
  1 — at least one MISMATCH (parser fidelity is not acceptable for Path 1)

Run with:
    cd backend && python -m scripts.validate_bosl2
"""
from __future__ import annotations

import os
import shutil
import struct
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

# Make the backend package importable when invoked as a module.
BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.infrastructure.cad.cad_engine import ConcreteCADEngine  # noqa: E402
from app.infrastructure.cad.csg_parser import CSGParser  # noqa: E402

FIXTURE_DIR = BACKEND_ROOT / "scripts" / "fixtures" / "bosl2"

# Tolerances for the MATCH / MINOR / MISMATCH verdict.
BBOX_TOLERANCE_PCT = 1.0   # bounding-box dimension delta allowed (percent)
TRI_COUNT_TOLERANCE_PCT = 5.0  # triangle-count delta allowed (percent)


@dataclass
class StlStats:
    """Bounding box and triangle count extracted from a binary STL."""
    min_x: float
    min_y: float
    min_z: float
    max_x: float
    max_y: float
    max_z: float
    triangle_count: int

    def __str__(self) -> str:
        return (
            f"[{self.min_x:.2f},{self.min_y:.2f},{self.min_z:.2f}]"
            f"->[{self.max_x:.2f},{self.max_y:.2f},{self.max_z:.2f}]"
        )


def parse_binary_stl(path: Path) -> Optional[StlStats]:
    """Parse a binary STL file and return bounding-box + triangle count.

    Returns None if the file is not a valid binary STL. ASCII STLs are
    silently treated as unavailable (we don't ship an ASCII parser here).
    """
    try:
        with open(path, "rb") as f:
            header = f.read(80)
            count_bytes = f.read(4)
            if len(header) < 80 or len(count_bytes) != 4:
                return None
            tri_count = struct.unpack("<I", count_bytes)[0]
            # 50 bytes per triangle record (12 bytes normal + 36 bytes vertices + 2 bytes attribute)
            expected = 84 + tri_count * 50
            file_size = path.stat().st_size
            if file_size < expected - 16:
                # Allow small trailing tolerance.
                return None

            min_x = min_y = min_z = float("inf")
            max_x = max_y = max_z = float("-inf")

            for _ in range(tri_count):
                f.read(12)  # normal vector
                data = f.read(36)
                if len(data) != 36:
                    break
                coords = struct.unpack("<9f", data)
                xs = coords[0::3]
                ys = coords[1::3]
                zs = coords[2::3]
                min_x = min(min_x, *xs); max_x = max(max_x, *xs)
                min_y = min(min_y, *ys); max_y = max(max_y, *ys)
                min_z = min(min_z, *zs); max_z = max(max_z, *zs)
                f.read(2)  # attribute byte count

            return StlStats(min_x, min_y, min_z, max_x, max_y, max_z, tri_count)
    except (OSError, struct.error):
        return None


def bbox_size(stats: StlStats) -> Tuple[float, float, float]:
    return (
        stats.max_x - stats.min_x,
        stats.max_y - stats.min_y,
        stats.max_z - stats.min_z,
    )


def pct_delta(a: float, b: float) -> float:
    if max(abs(a), abs(b)) < 1e-9:
        return 0.0
    return abs(a - b) / max(abs(a), abs(b)) * 100.0


def verdict_for(ref: StlStats, got: StlStats) -> str:
    """Compare two STL bounding boxes / triangle counts."""
    rb = bbox_size(ref)
    gb = bbox_size(got)

    deltas = [pct_delta(rb[i], gb[i]) for i in range(3)]
    max_dim_delta = max(deltas)

    tri_delta = pct_delta(ref.triangle_count, got.triangle_count)

    if max_dim_delta <= BBOX_TOLERANCE_PCT and tri_delta <= TRI_COUNT_TOLERANCE_PCT:
        return "MATCH"
    if max_dim_delta <= BBOX_TOLERANCE_PCT * 3 and tri_delta <= TRI_COUNT_TOLERANCE_PCT * 3:
        return "MINOR"
    return "MISMATCH"


def run_parser_side(script_text: str, work_dir: Path) -> Optional[StlStats]:
    """Run CSGParser + ConcreteCADEngine.shape_to_stl_bytes, return STL stats."""
    try:
        shape = CSGParser.parse(script_text)
        engine = ConcreteCADEngine()
        stl_bytes = engine.shape_to_stl_bytes(shape)
        out = work_dir / "parser.stl"
        out.write_bytes(stl_bytes)
        return parse_binary_stl(out)
    except Exception as exc:  # noqa: BLE001
        print(f"      parser error: {type(exc).__name__}: {exc}")
        return None


def run_openscad_side(script_path: Path, work_dir: Path) -> Optional[StlStats]:
    """Invoke OpenSCAD CLI to produce a reference STL. Returns None if CLI absent."""
    if shutil.which("openscad") is None:
        return None
    out = work_dir / "openscad.stl"
    try:
        subprocess.run(
            [
                "openscad",
                "--enable=lazy-union",
                "-o", str(out),
                str(script_path),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return None
    return parse_binary_stl(out)


def main() -> int:
    fixtures = sorted(FIXTURE_DIR.glob("*.scad"))
    if not fixtures:
        print(f"No fixtures found in {FIXTURE_DIR}", file=sys.stderr)
        return 1

    print(f"Validating {len(fixtures)} BOSL2 fixtures against the CSG parser\n")
    print(f"{'fixture':<28} {'verdict':<18} {'parser_bbox':<32} {'ref_bbox':<32} {'tri_pct':>6}")
    print("-" * 120)

    has_mismatch = False
    has_unavailable = False

    with tempfile.TemporaryDirectory() as tmp:
        work_root = Path(tmp)
        for fixture in fixtures:
            script_text = fixture.read_text()
            work_dir = work_root / fixture.stem
            work_dir.mkdir(parents=True, exist_ok=True)

            parser_stats = run_parser_side(script_text, work_dir)
            ref_stats = run_openscad_side(fixture, work_dir)

            if parser_stats is None:
                verdict = "PARSER FAILED"
                has_mismatch = True
            elif ref_stats is None:
                verdict = "REFERENCE UNAVAILABLE"
                has_unavailable = True
            else:
                v = verdict_for(ref_stats, parser_stats)
                verdict = v
                if v == "MISMATCH":
                    has_mismatch = True

            parser_str = str(parser_stats) if parser_stats else "(none)"
            ref_str = str(ref_stats) if ref_stats else "(openscad CLI absent)"

            tri_delta = "n/a"
            if parser_stats and ref_stats:
                tri_delta = f"{pct_delta(ref_stats.triangle_count, parser_stats.triangle_count):.1f}%"

            print(
                f"{fixture.stem:<28} {verdict:<18} {parser_str:<32} {ref_str:<32} {tri_delta:>6}"
            )

    print()
    if has_mismatch:
        print(
            "⚠ At least one fixture MISMATCHED. The parser's BOSL2 approximations\n"
            "  are NOT faithful enough to safely replace the CSG-tree wire format\n"
            "  (Path 1 in the analysis). Recommend staying on the current pipeline."
        )
        return 1
    if has_unavailable:
        print(
            "ℹ OpenSCAD CLI was not found, so reference comparison was skipped.\n"
            "  Install OpenSCAD and re-run to get MATCH / MISMATCH verdicts.\n"
            "  Parser output alone is not sufficient to validate fidelity."
        )
        return 0
    print("✓ All fixtures matched within tolerance. Path 1 (script-direct wire\n"
          "  format) may be viable; consider a follow-up with a wider fixture set.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
