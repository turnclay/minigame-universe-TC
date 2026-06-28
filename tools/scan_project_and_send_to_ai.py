import os
import textwrap
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
PROJECT_ROOT = os.getenv("PROJECT_ROOT", "./")

client = OpenAI(api_key=OPENAI_API_KEY)

# Extensions utiles (tu veux ignorer les .json → retiré)
ALLOWED_EXTENSIONS = {
    ".py", ".js", ".ts", ".html", ".css", ".md",
    ".yml", ".yaml", ".txt"
}

# Dossiers et fichiers à ignorer (mise à jour selon ta demande)
IGNORED_DIRS = {
    ".idea", ".venv", "__pycache__", "node_modules",
    "dist", "build", "assets", "img", "images",
    "static", "env", "logs",
    ".claude", ".env"  # ajoutés
}

IGNORED_FILES = {
    ".gitignore",
    ".render-restart",
    "arborV2.txt",
    "auto-push"
}

MAX_CHARS_PER_FILE = 20_000
MAX_TOTAL_CHARS = 150_000


def is_allowed_file(path: Path) -> bool:
    if path.name in IGNORED_FILES:
        return False
    return path.is_file() and path.suffix in ALLOWED_EXTENSIONS


def should_ignore(path: Path) -> bool:
    parts = path.parts
    return any(part in IGNORED_DIRS for part in parts)


def collect_project_snapshot(root: Path) -> str:
    parts = []
    total_chars = 0

    for path in root.rglob("*"):
        if should_ignore(path):
            continue

        if not is_allowed_file(path):
            continue

        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        if not content.strip():
            continue

        if len(content) > MAX_CHARS_PER_FILE:
            content = content[:MAX_CHARS_PER_FILE] + "\n\n# [TRONQUÉ]\n"

        block = f"\n\n=== {path.relative_to(root)} ===\n{content}\n"

        if total_chars + len(block) > MAX_TOTAL_CHARS:
            break

        parts.append(block)
        total_chars += len(block)

    return "".join(parts)


def ask_gpt4o_mini(snapshot: str, extra_instructions: str = "") -> str:
    system_prompt = textwrap.dedent("""
        Tu es un développeur senior.
        Tu reçois un snapshot partiel d’un projet MiniGame.
        Tu dois :
        - analyser l’architecture globale
        - identifier les modules de jeux, WS, scoring
        - proposer une documentation structurée
        - suggérer où brancher un nouveau mini-jeu UNO
        - respecter la source de vérité serveur et l’architecture WS.
    """)

    if extra_instructions:
        system_prompt += "\n\n" + extra_instructions

    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    "Voici un snapshot du projet (fichiers tronqués si trop longs) :\n"
                    + snapshot
                ),
            },
        ],
        temperature=0.2,
    )

    return resp.choices[0].message.content


def main():
    root = Path(PROJECT_ROOT).resolve()
    print(f"[INFO] Scan du projet : {root}")

    snapshot = collect_project_snapshot(root)
    if not snapshot.strip():
        print("[ERREUR] Aucun fichier valide trouvé.")
        return

    print("[INFO] Snapshot généré, envoi au modèle gpt-4o-mini...")
    doc = ask_gpt4o_mini(snapshot)

    output_path = root / "AI_PROJECT_ANALYSIS.md"
    output_path.write_text(doc, encoding="utf-8")

    print(f"[OK] Analyse/documentation générée dans : {output_path}")


if __name__ == "__main__":
    main()
