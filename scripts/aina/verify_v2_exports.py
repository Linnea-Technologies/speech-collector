#!/usr/bin/env python3
"""
Verify Speech Collector v2 normal export + databuilder export.

Run from:
  apps/speech-collector/

Examples:
  python scripts/aina/verify_v2_exports.py
  python scripts/aina/verify_v2_exports.py --run-exports
  python scripts/aina/verify_v2_exports.py --strict-v2-paths
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = APP_ROOT / ".env"


def ok(message: str) -> None:
    print(f"[OK] {message}")


def warn(message: str) -> None:
    print(f"[WARN] {message}")


def fail(message: str) -> None:
    print(f"[FAIL] {message}")


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        warn(f".env not found at {path}")
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def resolve_app_path(value: str | None, default: str) -> Path:
    raw = value or default
    path = Path(raw)
    if path.is_absolute():
        return path
    return APP_ROOT / path


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSONL at {path}:{line_no}: {exc}") from exc
    return rows


def md5_file(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_processed_audio_valid(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    return (
        value.get("sample_rate_hz") == 16000
        and value.get("channel_count") == 1
        and value.get("encoding") == "pcm_s16le"
    )


def inspect_wav(path: Path) -> tuple[int, int, int]:
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        sample_width = wav.getsampwidth()
    return sample_rate, channels, sample_width


def run_command(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=str(cwd),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )

def find_corepack() -> str | None:
    candidates = [
        shutil.which("corepack.cmd"),
        shutil.which("corepack.exe"),
        shutil.which("corepack"),
    ]

    for candidate in candidates:
        if candidate and Path(candidate).suffix.lower() in {".cmd", ".exe", ".bat"}:
            return candidate

    return next((candidate for candidate in candidates if candidate), None)


def run_command(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    # On Windows, .cmd shims are more reliable with shell=True.
    use_shell = os.name == "nt"
    return subprocess.run(
        " ".join(f'"{part}"' if " " in part else part for part in command) if use_shell else command,
        cwd=str(cwd),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
        shell=use_shell,
    )


def run_exports() -> bool:
    corepack = find_corepack()
    if not corepack:
        fail("corepack not found on PATH. Set your portable Node path first.")
        return False

    commands = [
        [corepack, "pnpm", "run", "aina:export"],
        [corepack, "pnpm", "run", "aina:export:databuilder"],
    ]

    all_ok = True
    for command in commands:
        print(f"\nRunning: {' '.join(command)}")
        result = run_command(command, APP_ROOT)
        print(result.stdout)
        if result.returncode != 0:
            fail(f"Command failed: {' '.join(command)}")
            all_ok = False
        else:
            ok(f"Command passed: {' '.join(command)}")
    return all_ok

def verify_env_paths(env: dict[str, str], strict_v2_paths: bool) -> bool:
    passed = True

    dataset_version = env.get("DATASET_VERSION", "")
    dataset_output_dir = env.get("DATASET_OUTPUT_DIR", "")
    databuilder_output_dir = env.get("DATABUILDER_OUTPUT_DIR", "")
    audio_prefix = env.get("COLLECTION_AUDIO_PREFIX", "")

    print("\nEnvironment path summary")
    print("========================")
    print(f"DATASET_VERSION={dataset_version}")
    print(f"DATASET_OUTPUT_DIR={dataset_output_dir}")
    print(f"DATABUILDER_OUTPUT_DIR={databuilder_output_dir}")
    print(f"COLLECTION_AUDIO_PREFIX={audio_prefix}")

    if dataset_version == "v2":
        if "v1" in dataset_output_dir.replace("\\", "/"):
            warn("DATASET_VERSION is v2 but DATASET_OUTPUT_DIR contains v1.")
            if strict_v2_paths:
                passed = False

        if "v1" in audio_prefix:
            warn("DATASET_VERSION is v2 but COLLECTION_AUDIO_PREFIX contains v1.")
            if strict_v2_paths:
                passed = False

        if "v1" in databuilder_output_dir.replace("\\", "/"):
            warn("DATASET_VERSION is v2 but DATABUILDER_OUTPUT_DIR contains v1.")
            if strict_v2_paths:
                passed = False

    return passed


def verify_normal_export(dataset_output_dir: Path) -> tuple[bool, set[str]]:
    print("\nNormal export verification")
    print("==========================")

    dataset_json = dataset_output_dir / "metadata" / "dataset.json"
    samples_jsonl = dataset_output_dir / "metadata" / "samples.jsonl"

    passed = True
    sample_ids: set[str] = set()

    if not dataset_json.exists():
        fail(f"Missing dataset.json: {dataset_json}")
        return False, sample_ids

    if not samples_jsonl.exists():
        fail(f"Missing samples.jsonl: {samples_jsonl}")
        return False, sample_ids

    dataset = load_json(dataset_json)
    samples = load_jsonl(samples_jsonl)

    ok(f"dataset.json exists: {dataset_json}")
    ok(f"samples.jsonl exists with {len(samples)} row(s)")

    if not samples:
        fail("samples.jsonl has no rows")
        return False, sample_ids

    if dataset.get("version") != "v2":
        warn(f"dataset.json version is {dataset.get('version')!r}, expected 'v2' for this new flow")

    required_root_keys = [
        "sample_id",
        "audio_path",
        "prompted_word",
        "normalized_label",
        "label",
        "literal_transcript",
        "label_source",
        "language",
        "duration_sec",
        "speaker_id",
    ]

    semantic_missing = 0
    phrase_missing = 0
    processed_invalid = 0

    for index, sample in enumerate(samples, start=1):
        sample_id = sample.get("sample_id")
        if isinstance(sample_id, str):
            sample_ids.add(sample_id)

        for key in required_root_keys:
            if key not in sample:
                fail(f"Sample {index} missing root key: {key}")
                passed = False

        if "phrase_id" not in sample or not sample.get("phrase_id"):
            phrase_missing += 1

        if "semantic_label" not in sample or not sample.get("semantic_label"):
            semantic_missing += 1

        metadata = sample.get("metadata")
        if not isinstance(metadata, dict):
            fail(f"Sample {sample_id or index} metadata is missing/not object")
            passed = False
            continue

        collection = metadata.get("collection")
        if not isinstance(collection, dict):
            fail(f"Sample {sample_id or index} metadata.collection missing/not object")
            passed = False
        else:
            if "phrase_id" not in collection:
                fail(f"Sample {sample_id or index} metadata.collection.phrase_id missing")
                passed = False
            if "semantic_label" not in collection:
                fail(f"Sample {sample_id or index} metadata.collection.semantic_label missing")
                passed = False

        processed_audio = metadata.get("processed_audio")
        technical = metadata.get("technical", {})
        if not is_processed_audio_valid(processed_audio):
            processed_invalid += 1
            warn(
                f"Sample {sample_id or index} processed_audio is not strict-valid: "
                f"{processed_audio!r}"
            )

        if isinstance(technical, dict) and technical.get("sample_rate_hz") == 48000:
            # This is okay. It is browser capture metadata, not saved training audio.
            pass

    if phrase_missing:
        warn(f"{phrase_missing} normal-export sample(s) missing phrase_id or have null phrase_id")
    else:
        ok("All normal-export samples include phrase_id")

    if semantic_missing:
        warn(f"{semantic_missing} normal-export sample(s) missing semantic_label or have null semantic_label")
    else:
        ok("All normal-export samples include semantic_label")

    if processed_invalid:
        warn(f"{processed_invalid} normal-export sample(s) have invalid/missing processed_audio")
    else:
        ok("All normal-export samples have valid processed_audio metadata")

    ok(f"Normal export sample IDs found: {len(sample_ids)}")
    return passed, sample_ids


def verify_databuilder_export(databuilder_output_dir: Path) -> tuple[bool, set[str]]:
    print("\nDatabuilder export verification")
    print("===============================")

    passed = True
    sample_ids: set[str] = set()

    manifest_path = databuilder_output_dir / "manifest.json"
    if not manifest_path.exists():
        fail(f"Missing manifest.json: {manifest_path}")
        return False, sample_ids

    manifest = load_json(manifest_path)
    samples = manifest.get("samples")

    if manifest.get("hash_algorithm") != "md5":
        fail(f"manifest.hash_algorithm is {manifest.get('hash_algorithm')!r}, expected 'md5'")
        passed = False
    else:
        ok("manifest.hash_algorithm is md5")

    if not isinstance(samples, dict) or not samples:
        fail("manifest.samples missing or empty")
        return False, sample_ids

    ok(f"manifest contains {len(samples)} sample(s)")

    required_sidecar_keys = [
        "sample_id",
        "prompted_word",
        "normalized_label",
        "literal_transcript",
        "label_source",
        "language",
        "category",
        "augmentation_strategy",
        "augmentations",
        "device_id",
        "speaker_id",
        "duration_sec",
        "demographics",
        "environment",
        "technical",
        "processed_audio",
        "collection",
        "storage",
    ]

    semantic_missing = 0
    phrase_missing = 0

    for sample_id, hash_info in samples.items():
        sample_ids.add(sample_id)

        wav_path = databuilder_output_dir / f"{sample_id}.wav"
        json_path = databuilder_output_dir / f"{sample_id}.json"

        if not wav_path.exists():
            fail(f"Missing WAV for {sample_id}: {wav_path}")
            passed = False
            continue

        if not json_path.exists():
            fail(f"Missing JSON sidecar for {sample_id}: {json_path}")
            passed = False
            continue

        expected_wav_hash = hash_info.get("wav_hash")
        expected_json_hash = hash_info.get("json_hash")
        actual_wav_hash = md5_file(wav_path)
        actual_json_hash = md5_file(json_path)

        if expected_wav_hash != actual_wav_hash:
            fail(f"{sample_id} wav_hash mismatch")
            passed = False

        if expected_json_hash != actual_json_hash:
            fail(f"{sample_id} json_hash mismatch")
            passed = False

        sidecar = load_json(json_path)

        if sidecar.get("sample_id") != sample_id:
            fail(f"{sample_id} sidecar sample_id does not match manifest key")
            passed = False

        for key in required_sidecar_keys:
            if key not in sidecar:
                fail(f"{sample_id} sidecar missing key: {key}")
                passed = False

        if "phrase_id" not in sidecar or not sidecar.get("phrase_id"):
            phrase_missing += 1

        if "semantic_label" not in sidecar or not sidecar.get("semantic_label"):
            semantic_missing += 1

        if sidecar.get("augmentation_strategy") is not None:
            fail(f"{sample_id} augmentation_strategy should be null for original recording")
            passed = False

        if sidecar.get("augmentations") != []:
            fail(f"{sample_id} augmentations should be [] for original recording")
            passed = False

        processed_audio = sidecar.get("processed_audio")
        if not is_processed_audio_valid(processed_audio):
            fail(f"{sample_id} processed_audio invalid: {processed_audio!r}")
            passed = False

        try:
            sample_rate, channels, sample_width = inspect_wav(wav_path)
            if sample_rate != 16000 or channels != 1 or sample_width != 2:
                fail(
                    f"{sample_id}.wav invalid audio format: "
                    f"{sample_rate} Hz, {channels} channel(s), {sample_width * 8}-bit"
                )
                passed = False
        except wave.Error as exc:
            fail(f"{sample_id}.wav could not be inspected as WAV: {exc}")
            passed = False

    if phrase_missing:
        warn(f"{phrase_missing} databuilder sample(s) missing phrase_id or have null phrase_id")
    else:
        ok("All databuilder sidecars include phrase_id")

    if semantic_missing:
        warn(f"{semantic_missing} databuilder sample(s) missing semantic_label or have null semantic_label")
    else:
        ok("All databuilder sidecars include semantic_label")

    if passed:
        ok("Databuilder manifest hashes, sidecars, and WAV formats are valid")

    return passed, sample_ids


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--run-exports",
        action="store_true",
        help="Run pnpm aina:export and aina:export:databuilder before verifying output",
    )
    parser.add_argument(
        "--strict-v2-paths",
        action="store_true",
        help="Fail if DATASET_VERSION=v2 but output/audio paths still contain v1",
    )
    args = parser.parse_args()

    env = read_env(ENV_PATH)

    dataset_version = env.get("DATASET_VERSION", "v1") or "v1"

    dataset_output_dir = resolve_app_path(
        env.get("DATASET_OUTPUT_DIR"),
        f"./exports/short-finnish-responses/{dataset_version}",
)

    databuilder_output_dir = resolve_app_path(
        env.get("DATABUILDER_OUTPUT_DIR"),
        f"./exports/short-finnish-responses/{dataset_version}/databuilder",
)

    checks: list[bool] = []

    checks.append(verify_env_paths(env, args.strict_v2_paths))

    if args.run_exports:
        checks.append(run_exports())

    normal_ok, normal_ids = verify_normal_export(dataset_output_dir)
    databuilder_ok, databuilder_ids = verify_databuilder_export(databuilder_output_dir)

    checks.extend([normal_ok, databuilder_ok])

    print("\nCross-export comparison")
    print("=======================")

    if databuilder_ids and normal_ids:
        missing_from_normal = databuilder_ids - normal_ids
        if missing_from_normal:
            fail(f"{len(missing_from_normal)} databuilder sample(s) missing from normal export")
            checks.append(False)
        else:
            ok("All databuilder samples exist in normal export")

        skipped_by_databuilder = normal_ids - databuilder_ids
        if skipped_by_databuilder:
            warn(
                f"{len(skipped_by_databuilder)} normal-export sample(s) not in databuilder export. "
                "This is okay if they were legacy/non-classifier-ready."
            )
        else:
            ok("Normal export and databuilder export contain the same sample IDs")

    print("\nSummary")
    print("=======")

    if all(checks):
        ok("Export verification passed")
        return 0

    fail("Export verification failed or has strict-path mismatch")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())