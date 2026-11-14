"""Run the existing scientific pipeline for the local combined website.

The Node server supplies an isolated output/database directory. Scientific models,
catalogue access and quality rules remain those of run_analysis.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

os.environ.setdefault("MPLBACKEND", "Agg")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--max-images", type=int, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--db-path", type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.max_images <= 360:
        parser.error("max-images must be between 1 and 360")

    from src.integration.pipeline import run_analysis

    result = run_analysis(args.target, args.start, args.end, max_images=args.max_images,
                          out_dir=str(args.output_dir.resolve()), db_path=str(args.db_path.resolve()),
                          log=lambda message: print(message, flush=True))
    record_path = Path(result.files["record"]).resolve()
    # Completion is reported only once run_analysis has written its real result.
    if not record_path.is_file() or not record_path.is_relative_to(args.output_dir.resolve()):
        raise RuntimeError("The analysis did not produce a result in its job directory")
    print("SPHEREX_WEB_RESULT=" + json.dumps({"sourceDir": str(record_path.parent)}), flush=True)


if __name__ == "__main__":
    main()
