from zhipuai import ZhipuAI
import os

API_KEY = os.getenv("ZHIPU_API_KEY")

if not API_KEY:
    print("ERREUR : définis ta clé API avec : setx ZHIPU_API_KEY \"ta_clé\"")
    exit()

client = ZhipuAI(api_key=API_KEY)

def main():
    print("=== Console ZhipuAI (GLM-4) ===")
    print("Tape 'exit' pour quitter.\n")

    while True:
        prompt = input("Zhipu > ").strip()
        if prompt.lower() in ("exit", "quit"):
            break
        if not prompt:
            continue

        try:
            response = client.chat.completions.create(
                model="glm-4",
                messages=[{"role": "user", "content": prompt}]
            )
            print("\n--- Réponse ---")
            print(response.choices[0].message["content"])
            print("\n")
        except Exception as e:
            print(f"[ERREUR] {e}\n")

if __name__ == "__main__":
    main()