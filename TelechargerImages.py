import json
import requests
from bs4 import BeautifulSoup
import os
import time
from urllib.parse import quote


def rechercher_image_produit(marque, nom_produit):
    """
    Recherche une image de produit sur Bing Images
    """
    # Construire la requête de recherche
    query = f"{marque} {nom_produit}"
    search_url = f"https://www.bing.com/images/search?q={quote(query)}"

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }

    try:
        print(f"  🔍 Recherche sur Bing : {query}")
        response = requests.get(search_url, headers=headers, timeout=10)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Chercher les images dans les résultats Bing
        img_tags = soup.find_all('a', class_='iusc')

        if img_tags:
            # Extraire l'URL de la première image
            m_attr = img_tags[0].get('m')
            if m_attr:
                img_data = json.loads(m_attr)
                url = img_data.get('murl') or img_data.get('turl')
                print(f"  ✅ URL trouvée : {url[:60]}...")
                return url

        print(f"  ⚠️ Aucune image trouvée")
        return None

    except Exception as e:
        print(f"  ❌ Erreur lors de la recherche : {e}")
        return None


def telecharger_image(url, chemin_sauvegarde):
    """
    Télécharge une image depuis une URL
    """
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        print(f"  📥 Téléchargement en cours...")
        response = requests.get(url, headers=headers, timeout=15, stream=True)
        response.raise_for_status()

        with open(chemin_sauvegarde, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        # Vérifier que le fichier a bien été créé
        if os.path.exists(chemin_sauvegarde) and os.path.getsize(chemin_sauvegarde) > 0:
            print(f"  ✅ Image sauvegardée : {chemin_sauvegarde}")
            return True
        else:
            print(f"  ❌ Fichier vide ou non créé")
            return False

    except Exception as e:
        print(f"  ❌ Erreur lors du téléchargement : {e}")
        return False


def traiter_produits(fichier_json='data/justeprix.json', dossier_images='images'):
    """
    Traite le fichier JSON et télécharge les images
    """
    print("=" * 60)
    print("🚀 TÉLÉCHARGEMENT DES IMAGES POUR JUSTE PRIX")
    print("=" * 60)
    print()

    # Créer le dossier pour les images s'il n'existe pas
    if not os.path.exists(dossier_images):
        os.makedirs(dossier_images)
        print(f"📁 Dossier '{dossier_images}/' créé")
    else:
        print(f"📁 Dossier '{dossier_images}/' existe déjà")

    # Vérifier que le fichier JSON existe
    if not os.path.exists(fichier_json):
        print(f"\n❌ ERREUR : Le fichier '{fichier_json}' n'existe pas!")
        print(f"💡 Assure-toi que le fichier est bien dans le dossier 'data/'")
        print(f"💡 Structure attendue :")
        print(f"   ton-projet/")
        print(f"   ├── data/")
        print(f"   │   └── justeprix.json")
        print(f"   └── TelechargerImages.py")
        return

    # Charger le JSON
    print(f"\n📂 Chargement de {fichier_json}...")
    with open(fichier_json, 'r', encoding='utf-8') as f:
        produits = json.load(f)

    print(f"📦 {len(produits)} produit(s) à traiter")
    print()
    print("=" * 60)
    print()

    # Traiter chaque produit
    nb_succes = 0
    nb_echecs = 0

    for i, produit in enumerate(produits, 1):
        marque = produit.get('Marque', '')
        nom = produit.get('Nom', '')
        produit_id = produit.get('ID', i)

        print(f"[{i}/{len(produits)}] 🏷️  {marque} - {nom}")

        # Rechercher l'image
        url_image = rechercher_image_produit(marque, nom)

        if url_image:
            # Définir le nom du fichier (compatible avec ton app web)
            extension = url_image.split('.')[-1].split('?')[0][:4]  # jpg, png, etc.
            if extension not in ['jpg', 'jpeg', 'png', 'webp', 'gif']:
                extension = 'jpg'  # par défaut

            nom_fichier = f"produit_{produit_id}.{extension}"
            chemin_complet = os.path.join(dossier_images, nom_fichier)

            # Télécharger l'image
            if telecharger_image(url_image, chemin_complet):
                # Chemin relatif pour le JSON (utilisable dans ton HTML/JS)
                produit['Image'] = f"{dossier_images}/{nom_fichier}"
                nb_succes += 1
            else:
                produit['Image'] = ""
                nb_echecs += 1
        else:
            produit['Image'] = ""
            nb_echecs += 1

        print()  # Ligne vide entre les produits

        # Pause pour éviter d'être bloqué par Bing
        if i < len(produits):  # Pas de pause après le dernier
            time.sleep(2)

    # Sauvegarder le JSON mis à jour
    print("=" * 60)
    print(f"💾 Sauvegarde du JSON mis à jour...")
    with open(fichier_json, 'w', encoding='utf-8') as f:
        json.dump(produits, f, ensure_ascii=False, indent=2)

    print(f"✅ Le fichier {fichier_json} a été mis à jour avec les chemins des images")
    print()

    # Statistiques finales
    print("=" * 60)
    print("📊 STATISTIQUES")
    print("=" * 60)
    print(f"✅ Réussites : {nb_succes}/{len(produits)}")
    print(f"❌ Échecs    : {nb_echecs}/{len(produits)}")
    print(f"📁 Images dans : {dossier_images}/")
    print()

    if nb_succes > 0:
        print("🎉 Tout est prêt ! Tu peux lancer ton jeu Juste Prix !")
        print("💡 Les images s'afficheront automatiquement dans ton interface.")
    else:
        print("⚠️ Aucune image n'a été téléchargée.")
        print("💡 Vérifie ta connexion internet ou réessaye plus tard.")

    print("=" * 60)


if __name__ == "__main__":
    # Lancer le téléchargement
    traiter_produits()