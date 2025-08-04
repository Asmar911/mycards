import base64
import json
import logging
import os
import zlib
from tqdm import tqdm  


def decode_recursive(data: bytes) -> bytes:
    """Recursively zlib decompress until no further compression, showing progress bar."""
    max_attempts = 50  # Upper limit to avoid infinite loops
    for _ in tqdm(range(max_attempts), desc="Decompressing"):
        try:
            data = zlib.decompress(data)
        except zlib.error:
            break
    return data


def main():
    input_file = "gameobjects.json"

    logging.basicConfig(
        filename="decode_game_objects.log",
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
    )

    print(f"Starting decoding process for '{input_file}'...")
    logging.info("Decoding %s", input_file)

    with open(input_file, "r", encoding="utf-8") as f:
        settings = json.load(f)
    print("Loaded input JSON file.")

    # Decode game_objects+
    encoded = settings.get("game_objects+")
    if encoded is None:
        raise SystemExit("Field 'game_objects+' not found in input JSON")

    padded = encoded + "=" * (-len(encoded) % 4)
    data = base64.urlsafe_b64decode(padded)
    print("Base64 decoded 'game_objects+'.")
    decoded_bytes = decode_recursive(data)
    print("Zlib recursively decompressed 'game_objects+'.")

    # Decode quizzes+
    encoded_quizzes = settings.get("quizzes+")
    if encoded_quizzes is None:
        raise SystemExit("Field 'quizzes+' not found in input JSON")

    padded_quizzes = encoded_quizzes + "=" * (-len(encoded_quizzes) % 4)
    data_quizzes = base64.urlsafe_b64decode(padded_quizzes)
    print("Base64 decoded 'quizzes+'.")
    decoded_bytes_quizzes = decode_recursive(data_quizzes)
    print("Zlib recursively decompressed 'quizzes+'.")

    try:
        game_objects = json.loads(decoded_bytes)
        quizzes = json.loads(decoded_bytes_quizzes)
    except json.JSONDecodeError as e:
        raise SystemExit(f"Failed to parse decoded data as JSON: {e}")
    print("Parsed both decoded fields as JSON.")

    # base, _ = os.path.splitext(input_file)
    game_objects_output_path = f"gameobjects_decoded.json"
    quizzes_output_path = f"gamequizzes_decoded.json"

    # Save game_objects decoded JSON
    with open(game_objects_output_path, "w", encoding="utf-8") as f:
        json.dump(game_objects, f, ensure_ascii=False, indent=2)
    print(f"Saved decoded 'game_objects+' JSON to '{game_objects_output_path}'.")
    logging.info("Decoded 'game_objects+' data saved to %s", game_objects_output_path)

    # Save quizzes decoded JSON
    # with open(quizzes_output_path, "w", encoding="utf-8") as f:
    #     json.dump(quizzes, f, ensure_ascii=False, indent=2)
    # print(f"Saved decoded 'quizzes+' JSON to '{quizzes_output_path}'.")
    # logging.info("Decoded 'quizzes+' data saved to %s", quizzes_output_path)

    print("Decoding process completed.")


if __name__ == "__main__":
    main()
