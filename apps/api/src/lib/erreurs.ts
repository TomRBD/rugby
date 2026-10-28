export class ErreurHttp extends Error {
  constructor(public statut: number, message: string, public code?: string) {
    super(message);
  }
}
export const nonTrouve = (quoi = 'Ressource') => new ErreurHttp(404, `${quoi} introuvable`);
export const interdit = (msg = 'Accès refusé') => new ErreurHttp(403, msg, 'interdit');
export const requeteInvalide = (msg: string) => new ErreurHttp(400, msg, 'invalide');
export const quotaAtteint = (msg: string) => new ErreurHttp(402, msg, 'quota');
