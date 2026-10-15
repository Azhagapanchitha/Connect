import Constants from 'expo-constants';

// The backend runs on port 4000 of the same machine that serves the Expo bundle.
// Override with EXPO_PUBLIC_API_URL (e.g. a deployed server) when needed.
function resolveApiUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:4000`;
}

export const API_URL = resolveApiUrl();

let authToken = null;
export const setAuthToken = (t) => { authToken = t; };

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Can't reach the server at ${API_URL}`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}
