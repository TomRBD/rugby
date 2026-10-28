"""Service IA de Rugby Analyse (GPU à la demande).

Appelé par le worker (variable IA_SERVICE_URL). Il ne crée jamais d'événement : il renvoie des
propositions avec un score de confiance, que l'analyste valide ou rejette dans l'écran de codage.

  POST /tracking  {"video": "<chemin ou URL HLS>", "calibration": [[u, v, x, y] x 4] (facultatif)}
      -> [{"piste", "camp", "numero", "confiance_numero", "positions": [[t, x, y], ...]}]
  POST /phases    {"video": "...", "duree": secondes}
      -> [{"type": "melee" | "touche" | "renvoi", "debut", "fin", "confiance"}]

Chaîne : détection des joueurs (YOLO) + suivi multi-objets (ByteTrack), séparation des équipes par la
couleur du maillot (k-moyennes), lecture des numéros dans le dos (OCR, à corriger à la main dans l'app),
projection sur le terrain par homographie (calibration sur 4 repères de lignes), puis reconnaissance
des phases arrêtées à partir des positions (regroupement compact = mêlée, deux files parallèles près
d'une ligne de touche = touche).
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

MODELE = os.environ.get("MODELE", "yolo11m.pt")
PAS_IMAGES = int(os.environ.get("PAS_IMAGES", "5"))  # analyse 1 image sur 5 (5 i/s pour une vidéo à 25 i/s)
LONGUEUR, LARGEUR = 100.0, 70.0

_modele = None
_lecteur_ocr = None


def modele():
    global _modele
    if _modele is None:
        from ultralytics import YOLO

        _modele = YOLO(MODELE)
    return _modele


def lecteur_ocr():
    global _lecteur_ocr
    if _lecteur_ocr is None:
        import easyocr

        _lecteur_ocr = easyocr.Reader(["en"], gpu=True)
    return _lecteur_ocr


def homographie(calibration):
    """Calibration terrain : 4 correspondances (pixel u, v) -> (mètres x, y) relevées sur les lignes."""
    if not calibration or len(calibration) < 4:
        return None
    src = np.float32([[c[0], c[1]] for c in calibration])
    dst = np.float32([[c[2], c[3]] for c in calibration])
    h, _ = cv2.findHomography(src, dst)
    return h


def projeter(h, u, v, l_img, h_img):
    if h is None:
        # Sans calibration : approximation proportionnelle à l'image (caméra centrale en tribune)
        return u / l_img * LONGUEUR, v / h_img * LARGEUR
    p = h @ np.array([u, v, 1.0])
    return float(p[0] / p[2]), float(p[1] / p[2])


def couleur_maillot(image, boite):
    x1, y1, x2, y2 = [int(a) for a in boite]
    hauteur = y2 - y1
    torse = image[y1 + hauteur // 5 : y1 + hauteur // 2, x1:x2]
    if torse.size == 0:
        return None
    hsv = cv2.cvtColor(torse, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(np.float32)
    # On écarte le vert du terrain
    masque = ~((hsv[:, 0] > 35) & (hsv[:, 0] < 85) & (hsv[:, 1] > 60))
    if masque.sum() < 10:
        return None
    return np.median(hsv[masque], axis=0)


def lire_numero(image, boite):
    x1, y1, x2, y2 = [int(a) for a in boite]
    dos = image[y1 + (y2 - y1) // 6 : y1 + (y2 - y1) // 2, x1:x2]
    if dos.size == 0 or dos.shape[0] < 20:
        return None, 0.0
    meilleurs = [
        (int(t), c)
        for _, t, c in lecteur_ocr().readtext(dos, allowlist="0123456789")
        if t.isdigit() and 1 <= int(t) <= 23
    ]
    return max(meilleurs, key=lambda x: x[1]) if meilleurs else (None, 0.0)


def tracking(video: str, calibration=None):
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    cap.release()
    h = homographie(calibration)
    positions = defaultdict(list)
    couleurs = defaultdict(list)
    numeros = defaultdict(lambda: defaultdict(float))
    for i, r in enumerate(
        modele().track(source=video, stream=True, persist=True, tracker="bytetrack.yaml", classes=[0], vid_stride=PAS_IMAGES, verbose=False)
    ):
        if r.boxes is None or r.boxes.id is None:
            continue
        image = r.orig_img
        h_img, l_img = image.shape[:2]
        t = round(i * PAS_IMAGES / fps, 2)
        for boite, piste in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.id.int().cpu().numpy()):
            u, v = (boite[0] + boite[2]) / 2, boite[3]  # pieds du joueur
            x, y = projeter(h, u, v, l_img, h_img)
            if -10 <= x <= 110 and -5 <= y <= 75:
                positions[int(piste)].append([t, round(x, 2), round(y, 2)])
            if i % 10 == 0:
                c = couleur_maillot(image, boite)
                if c is not None:
                    couleurs[int(piste)].append(c)
            if i % 25 == 0:
                n, conf = lire_numero(image, boite)
                if n:
                    numeros[int(piste)][n] += conf
    # Deux équipes (plus éventuellement l'arbitre) par k-moyennes sur la couleur médiane
    pistes = [p for p in positions if len(positions[p]) >= 10 and couleurs.get(p)]
    camps = {}
    if len(pistes) >= 4:
        donnees = np.float32([np.median(couleurs[p], axis=0) for p in pistes])
        _, etiquettes, _ = cv2.kmeans(donnees, 2, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.5), 5, cv2.KMEANS_PP_CENTERS)
        for p, e in zip(pistes, etiquettes.ravel()):
            camps[p] = "nous" if e == 0 else "adversaire"  # à confirmer dans l'app (bouton « inverser »)
    resultat = []
    for p in pistes:
        votes = numeros.get(p, {})
        numero, score = (max(votes.items(), key=lambda x: x[1]) if votes else (None, 0.0))
        resultat.append({
            "piste": p, "camp": camps.get(p), "numero": numero,
            "confiance_numero": round(min(1.0, score / 3), 2), "positions": positions[p],
        })
    return resultat


def phases(video: str, duree: float | None = None):
    """Phases arrêtées reconnues à partir des positions suivies (une image par seconde suffit)."""
    pistes = tracking(video)
    par_instant = defaultdict(list)
    for p in pistes:
        for t, x, y in p["positions"]:
            par_instant[round(t)].append((x, y, p["camp"]))
    propositions = []
    for t in sorted(par_instant):
        pts = np.array([[x, y] for x, y, _ in par_instant[t]])
        if len(pts) < 10:
            continue
        # Mêlée : au moins 12 joueurs dans un rayon de 4 m
        centre = np.median(pts, axis=0)
        proches = np.linalg.norm(pts - centre, axis=1) < 4
        if proches.sum() >= 12:
            propositions.append({"type": "melee", "debut": t - 2, "fin": t + 8, "confiance": round(min(0.95, proches.sum() / 16), 2)})
            continue
        # Touche : au moins 8 joueurs alignés perpendiculairement à la touche, entre 5 et 15 m du bord
        for bord in (0.0, LARGEUR):
            alignes = [(x, y) for x, y in pts if 5 <= abs(y - bord) <= 15]
            if len(alignes) >= 8 and np.std([x for x, _ in alignes]) < 2.5:
                propositions.append({"type": "touche", "debut": t - 3, "fin": t + 6, "confiance": round(min(0.9, len(alignes) / 14), 2)})
                break
    # Fusion des détections consécutives d'une même phase
    fusion = []
    for p in propositions:
        if fusion and fusion[-1]["type"] == p["type"] and p["debut"] <= fusion[-1]["fin"]:
            fusion[-1]["fin"] = p["fin"]
            fusion[-1]["confiance"] = max(fusion[-1]["confiance"], p["confiance"])
        else:
            fusion.append(p)
    return fusion


class Gestionnaire(BaseHTTPRequestHandler):
    def _repondre(self, code, corps):
        data = json.dumps(corps).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._repondre(200, {"ok": True, "modele": MODELE})

    def do_POST(self):
        try:
            corps = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            if self.path == "/tracking":
                return self._repondre(200, tracking(corps["video"], corps.get("calibration")))
            if self.path == "/phases":
                return self._repondre(200, phases(corps["video"], corps.get("duree")))
            return self._repondre(404, {"erreur": "inconnu"})
        except Exception as e:  # noqa: BLE001 - l'erreur est renvoyée au worker qui la journalise
            return self._repondre(500, {"erreur": str(e)})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8000"))), Gestionnaire).serve_forever()
