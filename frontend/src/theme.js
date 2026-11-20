const KEY = 'chatly-theme';

export function getTheme() {
  try {
    return localStorage.getItem(KEY) || 'system';
  } catch {
    return 'system';
  }
}

// 'system' theo cai dat cua may; 'light'/'dark' ghi de bang data-theme tren <html>.
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Trinh duyet chan luu tru: van doi giao dien cho phien hien tai.
  }
}
