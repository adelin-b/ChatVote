"""
Test Scaleway AI endpoint — check available models and test chat + embeddings.

Usage:
    # With key as env var:
    SCALEWAY_EMBED_API_KEY=<key> poetry run python scripts/test_scaleway.py

    # Or pass directly:
    poetry run python scripts/test_scaleway.py --key <key>
"""

import argparse
import os
import sys

SCALEWAY_BASE_URL = "https://api.scaleway.ai/78c3d473-15a8-46bf-9c9a-339d618c75b5/v1"


def get_key(args_key: str | None) -> str:
    key = (
        args_key
        or os.environ.get("SCALEWAY_EMBED_API_KEY")
        or os.environ.get("QWEN3_8B_SCW_SECRET_KEY")
    )
    if not key:
        print("ERROR: No API key. Set SCALEWAY_EMBED_API_KEY or pass --key")
        sys.exit(1)
    return key


def test_list_models(key: str) -> list[dict]:
    """List all models available on this Scaleway endpoint."""
    from openai import OpenAI

    client = OpenAI(base_url=SCALEWAY_BASE_URL, api_key=key)

    print("=" * 60)
    print("1. Listing available models...")
    print("=" * 60)

    try:
        models = client.models.list()
        chat_models = []
        embed_models = []

        for m in models.data:
            model_id = m.id
            # Heuristic: embedding models have "embed" in the name
            if "embed" in model_id.lower():
                embed_models.append(model_id)
            else:
                chat_models.append(model_id)
            print(f"  - {model_id}")

        print(f"\n  Chat/generation models: {chat_models or '(none found)'}")
        print(f"  Embedding models: {embed_models or '(none found)'}")
        return [{"id": m.id} for m in models.data]
    except Exception as e:
        print(f"  ERROR listing models: {e}")
        return []


def test_embedding(key: str):
    """Test embedding generation (qwen3-embedding-8b)."""
    from openai import OpenAI

    client = OpenAI(base_url=SCALEWAY_BASE_URL, api_key=key)

    print("\n" + "=" * 60)
    print("2. Testing embeddings (qwen3-embedding-8b)...")
    print("=" * 60)

    try:
        response = client.embeddings.create(
            input="Quelle est la politique énergétique de la France ?",
            model="qwen3-embedding-8b",
            dimensions=4096,
        )
        vec = response.data[0].embedding
        print(f"  OK — {len(vec)} dimensions")
        print(f"  First 5 values: {vec[:5]}")
    except Exception as e:
        print(f"  ERROR: {e}")


def test_chat(key: str, model: str):
    """Test chat completion with a given model."""
    from openai import OpenAI

    client = OpenAI(base_url=SCALEWAY_BASE_URL, api_key=key)

    print(f"\n{'=' * 60}")
    print(f"3. Testing chat completion ({model})...")
    print("=" * 60)

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "Tu es un assistant politique français. Réponds en français.",
                },
                {
                    "role": "user",
                    "content": "Qu'est-ce que la transition énergétique en une phrase ?",
                },
            ],
            max_tokens=150,
            temperature=0.3,
        )
        content = response.choices[0].message.content
        print(f"  OK — Response ({response.usage.total_tokens} tokens):")
        print(f"  {content}")
        return True
    except Exception as e:
        print(f"  ERROR: {e}")
        return False


def test_chat_streaming(key: str, model: str):
    """Test streaming chat completion."""
    from openai import OpenAI

    client = OpenAI(base_url=SCALEWAY_BASE_URL, api_key=key)

    print(f"\n{'=' * 60}")
    print(f"4. Testing streaming chat ({model})...")
    print("=" * 60)

    try:
        stream = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": "Donne 3 propositions écologiques en français, très court.",
                },
            ],
            max_tokens=200,
            temperature=0.3,
            stream=True,
        )
        print("  ", end="")
        chunks = 0
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                print(chunk.choices[0].delta.content, end="", flush=True)
                chunks += 1
        print(f"\n  OK — {chunks} chunks streamed")
        return True
    except Exception as e:
        print(f"  ERROR: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Test Scaleway AI endpoint")
    parser.add_argument("--key", help="Scaleway API key")
    args = parser.parse_args()

    key = get_key(args.key)

    print(f"Scaleway endpoint: {SCALEWAY_BASE_URL}")
    print()

    # 1. List models
    models = test_list_models(key)
    model_ids = [m["id"] for m in models]

    # 2. Test embeddings
    test_embedding(key)

    # 3. Try chat with available qwen models (skip embedding models)
    chat_candidates = [m for m in model_ids if "embed" not in m.lower()]

    if not chat_candidates:
        print("\n  No chat models found on this endpoint.")
        print("  This key only provides access to embedding models.")
        print("  For chat, you'd need a separate Scaleway deployment.")
    else:
        for model in chat_candidates:
            ok = test_chat(key, model)
            if ok:
                test_chat_streaming(key, model)
                break  # One successful test is enough

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"  Endpoint: {SCALEWAY_BASE_URL}")
    print(f"  Models found: {model_ids}")
    embed_ok = any("embed" in m.lower() for m in model_ids)
    chat_ok = any("embed" not in m.lower() for m in model_ids)
    print(f"  Embeddings available: {'YES' if embed_ok else 'NO'}")
    print(
        f"  Chat/generation available: {'YES' if chat_ok else 'NO — need separate deployment'}"
    )


if __name__ == "__main__":
    main()
