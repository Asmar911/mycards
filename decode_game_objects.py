import argparse
import base64
import json
import logging
import os
import zlib
import sys


def decode_recursive(data: bytes) -> bytes:
    """Recursively zlib decompress until no further compression."""
    while True:
        try:
            data = zlib.decompress(data)
        except zlib.error:
            break
    return data


def main():
    parser = argparse.ArgumentParser(
        description="Decode the 'game_objects+' field from a settings JSON file"
    )
    parser.add_argument("input", help="Path to settings JSON file")
    parser.add_argument(
        "-o",
        "--output",
        help=(
            "Output path for decoded JSON. Defaults to '<input>_decoded.json'"
        ),
    )
    args = parser.parse_args()

    logging.basicConfig(
        filename="decode_game_objects.log",
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
    )

    logging.info("Decoding %s", args.input)

    with open(args.input, "r", encoding="utf-8") as f:
        settings = json.load(f)

    encoded = settings.get("game_objects+")
    if encoded is None:
        raise SystemExit("Field 'game_objects+' not found in input JSON")

    # urlsafe base64 is used in the provided data; padding is optional
    padded = encoded + "=" * (-len(encoded) % 4)
    data = base64.urlsafe_b64decode(padded)
    decoded_bytes = decode_recursive(data)

    try:
        game_objects = json.loads(decoded_bytes)
    except json.JSONDecodeError as e:
        raise SystemExit(f"Failed to parse decoded data as JSON: {e}")

    if args.output:
        output_path = args.output
    else:
        base, _ = os.path.splitext(args.input)
        output_path = f"{base}_decoded.json"

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(game_objects, f, ensure_ascii=False, indent=2)

    logging.info("Decoded data saved to %s", output_path)

    if not args.output:
        # Also show result on stdout when no explicit output path is given
        json.dump(game_objects, fp=sys.stdout, ensure_ascii=False, indent=2)
        print()


if __name__ == "__main__":
    main()
