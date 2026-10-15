export function resolveBaseUrl(value) {
  let url;
  try {
    url = new URL(value ?? 'http://127.0.0.1:5173');
  } catch {
    throw new Error('AEGISLAB_WEB_URL must be a valid local HTTP origin');
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('AEGISLAB_WEB_URL must use a loopback HTTP origin (127.0.0.1 or localhost)');
  }
  return url.origin;
}
