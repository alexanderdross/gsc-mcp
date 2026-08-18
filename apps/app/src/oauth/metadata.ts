/**
 * OAuth-Metadaten-Dokumente ([docs/02]). Authorization Server Metadata (RFC 8414) und
 * Protected Resource Metadata (RFC 9728) — der MCP-Client entdeckt darüber die
 * Endpunkte und Verfahren. Reine Datenerzeugung; das Ausliefern übernimmt der HTTP-Layer
 * unter `/.well-known/…`.
 */

export interface AsMetadataConfig {
  /** Basis-URL des Authorization Servers, z. B. https://gsc2mcp.drossmedia.de */
  readonly issuer: string;
  readonly scopesSupported: readonly string[];
}

/** `/.well-known/oauth-authorization-server` (RFC 8414). */
export function authorizationServerMetadata(cfg: AsMetadataConfig): Record<string, unknown> {
  const base = cfg.issuer.replace(/\/$/, "");
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    scopes_supported: [...cfg.scopesSupported],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // OAuth 2.1: PKCE Pflicht, S256.
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
  };
}

export interface ResourceMetadataConfig {
  /** Kanonischer Bezeichner der geschützten Ressource, z. B. https://gsc2mcp.drossmedia.de/mcp */
  readonly resource: string;
  readonly authorizationServers: readonly string[];
  readonly scopesSupported: readonly string[];
}

/** `/.well-known/oauth-protected-resource` (RFC 9728) — verweist auf den AS. */
export function protectedResourceMetadata(cfg: ResourceMetadataConfig): Record<string, unknown> {
  return {
    resource: cfg.resource,
    authorization_servers: [...cfg.authorizationServers],
    scopes_supported: [...cfg.scopesSupported],
    bearer_methods_supported: ["header"],
  };
}
