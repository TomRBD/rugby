// Client HTTP de l'API : jeton de session, erreurs lisibles.
const CLE_JETON = 'rugby.jeton';

export class ErreurApi extends Error {
  constructor(public statut: number, message: string, public code?: string) {
    super(message);
  }
}

export function jeton(): string | null {
  try { return localStorage.getItem(CLE_JETON); } catch { return null; }
}
export function definirJeton(j: string | null) {
  try { if (j) localStorage.setItem(CLE_JETON, j); else localStorage.removeItem(CLE_JETON); } catch { /* navigation privée */ }
}

export async function api<T = any>(chemin: string, options: { methode?: string; corps?: unknown; brut?: BodyInit; type?: string; signal?: AbortSignal } = {}): Promise<T> {
  const entetes: Record<string, string> = {};
  const j = jeton();
  if (j) entetes.authorization = `Bearer ${j}`;
  let body: BodyInit | undefined;
  if (options.brut !== undefined) {
    body = options.brut;
    entetes['content-type'] = options.type ?? 'application/octet-stream';
  } else if (options.corps !== undefined) {
    body = JSON.stringify(options.corps);
    entetes['content-type'] = 'application/json';
  }
  const r = await fetch(chemin, { method: options.methode ?? (body ? 'POST' : 'GET'), headers: entetes, body, signal: options.signal });
  if (!r.ok) {
    let msg = `Erreur ${r.status}`;
    let code: string | undefined;
    try { const e = await r.json(); msg = e.erreur ?? msg; code = e.code; } catch { /* corps vide */ }
    if (r.status === 401 && code === 'non_connecte') { definirJeton(null); }
    throw new ErreurApi(r.status, msg, code);
  }
  const ct = r.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? r.json() : r.blob()) as Promise<T>;
}

/** Ouvre un fichier (PDF, CSV, Excel) renvoyé par l'API. */
export async function telecharger(chemin: string, nom: string) {
  const blob = await api<Blob>(chemin);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  if (blob.type === 'application/pdf') a.target = '_blank';
  else a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
