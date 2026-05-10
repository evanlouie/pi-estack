#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11,<4"
# dependencies = []
# ///
"""Split Agent Skill trigger eval queries into train and validation sets."""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any


def load_queries(path: Path) -> list[dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, list):
        raise ValueError("eval queries file must be a JSON list")
    for idx, item in enumerate(data):
        if not isinstance(item, dict):
            raise ValueError(f"query {idx} must be an object")
        if "query" not in item or "should_trigger" not in item:
            raise ValueError(f"query {idx} must include query and should_trigger")
        if not isinstance(item["query"], str) or not item["query"].strip():
            raise ValueError(f"query {idx} has an empty query")
        if not isinstance(item["should_trigger"], bool):
            raise ValueError(f"query {idx} should_trigger must be true or false")
    return data


def split_balanced(queries: list[dict[str, Any]], train_ratio: float, seed: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rng = random.Random(seed)
    positives = [q for q in queries if q["should_trigger"]]
    negatives = [q for q in queries if not q["should_trigger"]]
    rng.shuffle(positives)
    rng.shuffle(negatives)

    def split_group(group: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        if not group:
            return [], []
        train_count = round(len(group) * train_ratio)
        if len(group) > 1:
            train_count = min(max(1, train_count), len(group) - 1)
        return group[:train_count], group[train_count:]

    train_pos, validation_pos = split_group(positives)
    train_neg, validation_neg = split_group(negatives)
    train = train_pos + train_neg
    validation = validation_pos + validation_neg
    rng.shuffle(train)
    rng.shuffle(validation)
    return train, validation


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Split eval_queries.json into balanced train and validation files.",
        epilog="Example: uv run scripts/split_trigger_evals.py evals/eval_queries.json --train-out evals/train_queries.json --validation-out evals/validation_queries.json",
    )
    parser.add_argument("queries", help="Path to eval_queries.json")
    parser.add_argument("--train-ratio", type=float, default=0.6, help="Fraction of positives and negatives assigned to train (default: 0.6)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducible splits")
    parser.add_argument("--train-out", default="train_queries.json", help="Output path for train queries")
    parser.add_argument("--validation-out", default="validation_queries.json", help="Output path for validation queries")
    args = parser.parse_args(argv)

    if not 0 < args.train_ratio < 1:
        print("Error: --train-ratio must be between 0 and 1", file=sys.stderr)
        return 2

    try:
        queries = load_queries(Path(args.queries))
        train, validation = split_balanced(queries, args.train_ratio, args.seed)
        write_json(Path(args.train_out), train)
        write_json(Path(args.validation_out), validation)
    except Exception as exc:  # noqa: BLE001 - CLI error boundary
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    summary = {
        "total": len(queries),
        "train": len(train),
        "validation": len(validation),
        "train_should_trigger": sum(1 for q in train if q["should_trigger"]),
        "validation_should_trigger": sum(1 for q in validation if q["should_trigger"]),
        "train_out": args.train_out,
        "validation_out": args.validation_out,
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
