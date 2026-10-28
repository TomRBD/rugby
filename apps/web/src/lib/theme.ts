export type Theme = 'auto' | 'clair' | 'sombre' | 'soleil';

export function themeCourant(): Theme {
  try { return (localStorage.getItem('rugby.theme') as Theme) || 'auto'; } catch { return 'auto'; }
}

export function appliquerTheme(t: Theme = themeCourant()) {
  try { localStorage.setItem('rugby.theme', t); } catch { /* ignoré */ }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
