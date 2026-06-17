const TOKEN_KEY = 'axiomify_studio_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const updatedOptions: RequestInit = {
    ...options,
    headers,
  };

  const response = await fetch(url, updatedOptions);

  if (response.status === 401 && !url.includes('/__studio/api/discovery')) {
    removeToken();
    window.dispatchEvent(new CustomEvent('axiomify-unauthorized'));
  }

  return response;
}
