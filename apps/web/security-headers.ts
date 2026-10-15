export const previewSecurityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
} as const;

// The Vite development server injects a refresh preamble and uses an HMR socket.
export const devSecurityHeaders = {
  ...previewSecurityHeaders,
  'Content-Security-Policy': "frame-ancestors 'none'",
} as const;
