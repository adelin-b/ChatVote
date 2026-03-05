"""
Auto-generate golden test cases from crawled content using DeepEval Synthesizer.

Reads markdown files from firebase/firestore_data/dev/crawled_content/,
chunks them with LangChain, and generates question/answer pairs for RAG evaluation.

Usage:
    poetry run python scripts/generate_goldens.py
    poetry run python scripts/generate_goldens.py --max-per-doc 3 --output tests/eval/datasets/generated_goldens.json
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

CRAWLED_CONTENT_DIR = (
    PROJECT_ROOT / "firebase" / "firestore_data" / "dev" / "crawled_content"
)
DEFAULT_OUTPUT = PROJECT_ROOT / "tests" / "eval" / "datasets" / "generated_goldens.json"


def _build_ollama_model():
    """Build OllamaModel for the synthesizer."""
    from deepeval.models import OllamaModel

    ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_model = os.environ.get("OLLAMA_MODEL", "llama3.2")

    try:
        import urllib.request
        urllib.request.urlopen(ollama_url, timeout=3)
    except Exception:
        print(f"ERROR: Ollama not reachable at {ollama_url}")
        print("Start Ollama with: ollama serve")
        sys.exit(1)

    return OllamaModel(model=ollama_model, base_url=ollama_url, temperature=0.0)


def _collect_markdown_files(content_dir: Path, entity_type: str | None = None) -> list[dict]:
    """Collect markdown files with metadata from crawled content directory."""
    results = []
    search_dirs = []

    if entity_type:
        search_dirs.append(content_dir / entity_type)
    else:
        search_dirs.extend([content_dir / "parties", content_dir / "candidates"])

    skip_names = {"mentions-legales", "politique-de-confidentialite", "cgu", "mentions",
                  "copie-de-mentions-legales", "desabonnement-des-listes-de-diffusion",
                  "informations-juridiques", "presse", "contacts-presse", "kit-graphique",
                  "charte-graphique"}

    for search_dir in search_dirs:
        if not search_dir.exists():
            continue
        for md_file in sorted(search_dir.rglob("*.md")):
            content = md_file.read_text(errors="ignore").strip()
            if len(content) < 200:
                continue
            if md_file.stem in skip_names:
                continue

            info = _extract_entity_info(str(md_file))
            results.append({
                "path": str(md_file),
                "content": content,
                "name": md_file.stem,
                **info,
            })

    return results


def _extract_entity_info(filepath: str) -> dict:
    """Extract party/candidate ID and type from file path."""
    path = Path(filepath)
    parts = path.parts

    try:
        cc_idx = parts.index("crawled_content")
        entity_type = parts[cc_idx + 1]
        entity_id = parts[cc_idx + 2]
        return {"entity_type": entity_type, "entity_id": entity_id}
    except (ValueError, IndexError):
        return {"entity_type": "unknown", "entity_id": "unknown"}


def _chunk_documents(docs: list[dict], chunk_size: int = 800, chunk_overlap: int = 100) -> list[list[str]]:
    """Chunk documents into context groups using LangChain splitter.

    Returns list of contexts, where each context is a list of 1-3 related chunks
    from the same document.
    """
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    contexts = []
    for doc in docs:
        chunks = splitter.split_text(doc["content"])
        if not chunks:
            continue

        # Add entity info as prefix to each chunk for context
        prefix = f"[Source: {doc['entity_type']}/{doc['entity_id']} — {doc['name']}]\n"
        chunks = [prefix + c for c in chunks]

        # Group chunks into contexts of 2-3 related chunks
        for i in range(0, len(chunks), 2):
            context_group = chunks[i:i + 3]
            if len(context_group) >= 1:
                contexts.append(context_group)

    return contexts


def generate_goldens(
    max_per_context: int = 2,
    max_docs: int = 20,
    output_path: Path = DEFAULT_OUTPUT,
    entity_type: str | None = None,
):
    """Generate golden test cases from crawled documents."""
    from deepeval.synthesizer import Synthesizer
    from deepeval.synthesizer.config import EvolutionConfig, FiltrationConfig
    from deepeval.synthesizer.types import Evolution

    start_time = time.time()

    print("Building Ollama model for synthesis...")
    model = _build_ollama_model()

    print(f"Collecting markdown files from {CRAWLED_CONTENT_DIR}...")
    docs = _collect_markdown_files(CRAWLED_CONTENT_DIR, entity_type)

    if not docs:
        print("ERROR: No markdown files found in crawled content directory.")
        print(f"Expected at: {CRAWLED_CONTENT_DIR}")
        sys.exit(1)

    # Limit and prioritize documents
    if len(docs) > max_docs:
        priority_stems = {"programme", "projet", "index", "nos-valeurs", "les-urgences",
                          "engagements", "pacte-lyonnais", "lyon-de-demain",
                          "nos-ambitions-municipales", "notre-programme", "notre-projet"}
        priority = [d for d in docs if d["name"] in priority_stems]
        rest = [d for d in docs if d not in priority]
        docs = (priority + rest)[:max_docs]

    print(f"Using {len(docs)} documents for golden generation:")
    for d in docs:
        print(f"  - [{d['entity_type']}/{d['entity_id']}] {d['name']}.md ({len(d['content'])} chars)")

    # Chunk documents manually (avoids chromadb dependency)
    print("\nChunking documents...")
    contexts = _chunk_documents(docs)
    print(f"Created {len(contexts)} context groups from {len(docs)} documents")

    # Limit contexts to keep generation time reasonable
    max_contexts = max_docs * 3
    if len(contexts) > max_contexts:
        contexts = contexts[:max_contexts]
        print(f"Limited to {max_contexts} contexts")

    # Configure synthesizer
    evolution_config = EvolutionConfig(
        num_evolutions=1,
        evolutions={
            Evolution.REASONING: 0.3,
            Evolution.COMPARATIVE: 0.3,
            Evolution.CONCRETIZING: 0.2,
            Evolution.IN_BREADTH: 0.2,
        },
    )

    filtration_config = FiltrationConfig(
        synthetic_input_quality_threshold=0.3,
        max_quality_retries=2,
        critic_model=model,
    )

    print("\nInitializing synthesizer...")
    synthesizer = Synthesizer(
        model=model,
        async_mode=False,
        evolution_config=evolution_config,
        filtration_config=filtration_config,
    )

    print(f"Generating goldens from {len(contexts)} contexts (this may take a while with Ollama)...")
    try:
        goldens = synthesizer.generate_goldens_from_contexts(
            contexts=contexts,
            max_goldens_per_context=max_per_context,
            include_expected_output=True,
        )
    except Exception as e:
        print(f"Error during generation: {e}")
        print("Trying with fewer contexts (first 10)...")
        goldens = synthesizer.generate_goldens_from_contexts(
            contexts=contexts[:10],
            max_goldens_per_context=max_per_context,
            include_expected_output=True,
        )

    elapsed = time.time() - start_time

    # Convert to our test format
    result = {
        "generated": [],
        "metadata": {
            "timestamp": datetime.now().isoformat(),
            "source_docs": len(docs),
            "total_contexts": len(contexts),
            "total_goldens": len(goldens),
            "model": os.environ.get("OLLAMA_MODEL", "llama3.2"),
            "elapsed_s": round(elapsed, 1),
            "docs_used": [
                {"entity_type": d["entity_type"], "entity_id": d["entity_id"], "name": d["name"]}
                for d in docs
            ],
        },
    }

    for golden in goldens:
        entry = {
            "input": golden.input,
            "expected_output": golden.expected_output or "",
            "retrieval_context": golden.context or [],
        }
        # Extract source info from context if available
        if golden.context:
            for ctx in golden.context:
                if ctx.startswith("[Source:"):
                    source_line = ctx.split("]")[0] + "]"
                    entry["source"] = source_line
                    break
        result["generated"].append(entry)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2, ensure_ascii=False))

    print(f"\nGenerated {len(goldens)} golden test cases in {elapsed:.0f}s")
    print(f"Saved to: {output_path}")

    # Show samples
    for i, g in enumerate(goldens[:3]):
        print(f"\n--- Sample {i+1} ---")
        print(f"Q: {g.input}")
        print(f"A: {(g.expected_output or '')[:150]}...")


def main():
    parser = argparse.ArgumentParser(description="Generate golden test cases from crawled content")
    parser.add_argument("--max-per-context", type=int, default=2, help="Max goldens per context group")
    parser.add_argument("--max-docs", type=int, default=20, help="Max documents to process")
    parser.add_argument("--output", type=str, default=str(DEFAULT_OUTPUT), help="Output JSON path")
    parser.add_argument("--type", choices=["parties", "candidates"], help="Filter by entity type")
    args = parser.parse_args()

    generate_goldens(
        max_per_context=args.max_per_context,
        max_docs=args.max_docs,
        output_path=Path(args.output),
        entity_type=args.type,
    )


if __name__ == "__main__":
    main()
