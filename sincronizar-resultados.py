# sincronizar-resultados.py
# Obtiene resultados del Mundial 2026 de la API gratuita worldcup26.ir
# y los sube a Firestore automáticamente.
#
# USO MANUAL:
#   $env:REQUESTS_CA_BUNDLE="all-certs.pem"
#   python sincronizar-resultados.py --service-account serviceAccount.json
#
# USO AUTOMATICO (Programador de tareas de Windows, cada hora):
#   Accion: python "C:\ruta\sincronizar-resultados.py" --service-account "C:\ruta\serviceAccount.json"
#   Desencadenador: cada 1 hora, solo dias con partidos (ver calendario)

import argparse
import json
import sys
import requests
from google.oauth2 import service_account
import google.auth.transport.requests

PROJECT_ID  = "porra-mundial-2026-98179"
PORRA_ID    = "mundial-2026"
API_URL     = "https://worldcup26.ir/get/games"
FIRESTORE   = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents"

# Mapa: nombre en la API → nombre canónico en la app
# La API usa nombres en inglés; los mapeamos a los de data.js
TEAM_MAP = {
    "Mexico":                  "México",
    "South Africa":            "Sudáfrica",
    "South Korea":             "Corea del Sur",
    "Czech Republic":          "Chequia",
    "Czechia":                 "Chequia",
    "Canada":                  "Canadá",
    "Bosnia and Herzegovina":  "Bosnia y Herzegovina",
    "Bosnia & Herzegovina":    "Bosnia y Herzegovina",
    "United States":           "Estados Unidos",
    "USA":                     "Estados Unidos",
    "Paraguay":                "Paraguay",
    "Haiti":                   "Haití",
    "Scotland":                "Escocia",
    "Australia":               "Australia",
    "Turkey":                  "Turquía",
    "Brazil":                  "Brasil",
    "Morocco":                 "Marruecos",
    "Qatar":                   "Qatar",
    "Switzerland":             "Suiza",
    "Ivory Coast":             "Costa de Marfil",
    "Côte d'Ivoire":           "Costa de Marfil",
    "Ecuador":                 "Ecuador",
    "Germany":                 "Alemania",
    "Curacao":                 "Curazao",
    "Curaçao":                 "Curazao",
    "Netherlands":             "Países Bajos",
    "Japan":                   "Japón",
    "Sweden":                  "Suecia",
    "Tunisia":                 "Túnez",
    "Saudi Arabia":            "Arabia Saudí",
    "Uruguay":                 "Uruguay",
    "Spain":                   "España",
    "Cape Verde":              "Cabo Verde",
    "Iran":                    "Irán",
    "New Zealand":             "Nueva Zelanda",
    "Belgium":                 "Bélgica",
    "Egypt":                   "Egipto",
    "France":                  "Francia",
    "Senegal":                 "Senegal",
    "Iraq":                    "Irak",
    "Norway":                  "Noruega",
    "Argentina":               "Argentina",
    "Algeria":                 "Argelia",
    "Austria":                 "Austria",
    "Jordan":                  "Jordania",
    "Ghana":                   "Ghana",
    "Panama":                  "Panamá",
    "England":                 "Inglaterra",
    "Croatia":                 "Croacia",
    "Portugal":                "Portugal",
    "DR Congo":                "RD Congo",
    "Democratic Republic of Congo": "RD Congo",
    "Uzbekistan":              "Uzbekistán",
    "Colombia":                "Colombia",
}

# Partidos de la app: (match_id, home_canónico, away_canónico)
MATCHES_APP = [
    ("m01","México","Sudáfrica"),("m02","Corea del Sur","Chequia"),
    ("m03","Canadá","Bosnia y Herzegovina"),("m04","Estados Unidos","Paraguay"),
    ("m05","Haití","Escocia"),("m06","Australia","Turquía"),
    ("m07","Brasil","Marruecos"),("m08","Qatar","Suiza"),
    ("m09","Costa de Marfil","Ecuador"),("m10","Alemania","Curazao"),
    ("m11","Países Bajos","Japón"),("m12","Suecia","Túnez"),
    ("m13","Arabia Saudí","Uruguay"),("m14","España","Cabo Verde"),
    ("m15","Irán","Nueva Zelanda"),("m16","Bélgica","Egipto"),
    ("m17","Francia","Senegal"),("m18","Irak","Noruega"),
    ("m19","Argentina","Argelia"),("m20","Austria","Jordania"),
    ("m21","Ghana","Panamá"),("m22","Inglaterra","Croacia"),
    ("m23","Portugal","RD Congo"),("m24","Uzbekistán","Colombia"),
    ("m25","Chequia","Sudáfrica"),("m26","Suiza","Bosnia y Herzegovina"),
    ("m27","Canadá","Qatar"),("m28","México","Corea del Sur"),
    ("m29","Brasil","Haití"),("m30","Escocia","Marruecos"),
    ("m31","Turquía","Paraguay"),("m32","Estados Unidos","Australia"),
    ("m33","Alemania","Costa de Marfil"),("m34","Ecuador","Curazao"),
    ("m35","Países Bajos","Suecia"),("m36","Túnez","Japón"),
    ("m37","Uruguay","Cabo Verde"),("m38","España","Arabia Saudí"),
    ("m39","Bélgica","Irán"),("m40","Nueva Zelanda","Egipto"),
    ("m41","Noruega","Senegal"),("m42","Francia","Irak"),
    ("m43","Argentina","Austria"),("m44","Jordania","Argelia"),
    ("m45","Inglaterra","Ghana"),("m46","Panamá","Croacia"),
    ("m47","Portugal","Uzbekistán"),("m48","Colombia","RD Congo"),
    ("m49","Escocia","Brasil"),("m50","Marruecos","Haití"),
    ("m51","Suiza","Canadá"),("m52","Bosnia y Herzegovina","Qatar"),
    ("m53","Chequia","México"),("m54","Sudáfrica","Corea del Sur"),
    ("m55","Curazao","Costa de Marfil"),("m56","Ecuador","Alemania"),
    ("m57","Japón","Suecia"),("m58","Túnez","Países Bajos"),
    ("m59","Turquía","Estados Unidos"),("m60","Paraguay","Australia"),
    ("m61","Noruega","Francia"),("m62","Senegal","Irak"),
    ("m63","Egipto","Irán"),("m64","Nueva Zelanda","Bélgica"),
    ("m65","Cabo Verde","Arabia Saudí"),("m66","Uruguay","España"),
    ("m67","Panamá","Inglaterra"),("m68","Croacia","Ghana"),
    ("m69","Argelia","Austria"),("m70","Jordania","Argentina"),
    ("m71","Colombia","Portugal"),("m72","RD Congo","Uzbekistán"),
]

def get_token(sa_path):
    creds = service_account.Credentials.from_service_account_file(
        sa_path,
        scopes=["https://www.googleapis.com/auth/datastore"]
    )
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token

def fetch_api_results():
    r = requests.get(API_URL, timeout=15)
    r.raise_for_status()
    data = r.json()
    # La API puede devolver lista o dict con clave 'games'/'matches'/'data'
    if isinstance(data, list):
        return data
    for key in ("games", "matches", "data", "results"):
        if key in data:
            return data[key]
    return []

def canonical_team(name):
    return TEAM_MAP.get(name, name)

def build_match_index():
    idx = {}
    for mid, home, away in MATCHES_APP:
        idx[frozenset([home, away])] = (mid, home, away)
    return idx

def get_current_results(token):
    url = f"{FIRESTORE}/porras/{PORRA_ID}/app/results"
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"})
    if r.status_code == 404:
        return {}
    r.raise_for_status()
    doc = r.json()
    raw = doc.get("fields", {}).get("results", {}).get("mapValue", {}).get("fields", {})
    results = {}
    for mid, val in raw.items():
        inner = val.get("mapValue", {}).get("fields", {})
        h = inner.get("home", {}).get("stringValue", "")
        a = inner.get("away", {}).get("stringValue", "")
        results[mid] = {"home": h, "away": a}
    return results

def save_results(token, results):
    # Build Firestore REST format
    fields_map = {}
    for mid, score in results.items():
        fields_map[mid] = {
            "mapValue": {
                "fields": {
                    "home": {"stringValue": str(score["home"])},
                    "away": {"stringValue": str(score["away"])},
                }
            }
        }
    body = {
        "fields": {
            "results": {
                "mapValue": {"fields": fields_map}
            }
        }
    }
    url = f"{FIRESTORE}/porras/{PORRA_ID}/app/results"
    r = requests.patch(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=body
    )
    r.raise_for_status()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service-account", required=True)
    parser.add_argument("--dry-run", action="store_true", help="Solo muestra lo que haría, sin escribir")
    args = parser.parse_args()

    print("Obteniendo token de Firebase...")
    token = get_token(args.service_account)
    print("✓ Autenticado\n")

    print(f"Consultando API: {API_URL}")
    try:
        api_games = fetch_api_results()
    except Exception as e:
        print(f"✗ Error al consultar la API: {e}")
        sys.exit(1)
    print(f"  → {len(api_games)} partidos recibidos de la API\n")

    match_index = build_match_index()
    current = get_current_results(token)

    new_results = dict(current)
    updated = 0
    skipped = 0
    unmatched = 0

    for game in api_games:
        # Campos posibles en la API (puede variar)
        home_raw = game.get("homeTeam", game.get("home_team", game.get("home", {}))).get("name", "") if isinstance(game.get("homeTeam", game.get("home_team", "")), dict) else game.get("homeTeam", game.get("home_team", game.get("home", "")))
        away_raw = game.get("awayTeam", game.get("away_team", game.get("away", {}))).get("name", "") if isinstance(game.get("awayTeam", game.get("away_team", "")), dict) else game.get("awayTeam", game.get("away_team", game.get("away", "")))
        home_score = game.get("homeScore", game.get("home_score", game.get("score", {}).get("home", None)))
        away_score = game.get("awayScore", game.get("away_score", game.get("score", {}).get("away", None)))
        status = game.get("status", game.get("matchStatus", "")).lower()

        # Solo partidos terminados
        if status not in ("completed", "finished", "ft", "full-time", "fulltime", "ended"):
            skipped += 1
            continue

        if home_score is None or away_score is None:
            skipped += 1
            continue

        home_can = canonical_team(str(home_raw).strip())
        away_can = canonical_team(str(away_raw).strip())
        key = frozenset([home_can, away_can])

        if key not in match_index:
            print(f"  ⚠  Sin cruzar: {home_raw} vs {away_raw} → {home_can} vs {away_can}")
            unmatched += 1
            continue

        mid, _, _ = match_index[key]
        existing = current.get(mid, {})

        # Solo actualizar si cambia
        if existing.get("home") == str(home_score) and existing.get("away") == str(away_score):
            continue

        new_results[mid] = {"home": str(home_score), "away": str(away_score)}
        flag = "[DRY-RUN] " if args.dry_run else ""
        print(f"  {flag}✓  {mid}: {home_can} {home_score}-{away_score} {away_can}")
        updated += 1

    print(f"\n{updated} resultados nuevos/actualizados | {skipped} partidos no terminados | {unmatched} sin cruzar")

    if updated > 0 and not args.dry_run:
        print("\nGuardando en Firestore...")
        save_results(token, new_results)
        print("✓ Firestore actualizado — todos los usuarios verán los cambios al instante")
    elif updated > 0 and args.dry_run:
        print("\n[DRY-RUN] No se ha escrito nada. Ejecuta sin --dry-run para aplicar.")
    else:
        print("\nNo hay cambios que aplicar.")

if __name__ == "__main__":
    main()
