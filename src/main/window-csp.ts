/** Content Security Policy for the renderer. Shared by the protocol handler and the build. */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  // KaTeX writes inline style attributes for glyph positioning.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'"
].join('; ')
