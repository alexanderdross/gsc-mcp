/**
 * Konfiguration aus der Umgebung ([docs/01], [docs/08]). Rein: `loadConfig(env)` prüft
 * und normalisiert; das Lesen aus `process.env` macht nur der Einstiegspunkt (`main.ts`).
 * Secrets kommen ausschließlich aus der Umgebung/eingehängten Dateien, nie aus dem Repo.
 */

export interface GoogleConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface AppConfig {
  readonly port: number;
  /** Basis-URL des AS/Servers, z. B. https://gsc2mcp.drossmedia.de */
  readonly issuer: string;
  /** Geschützte Ressource (RFC 8707) — der MCP-Endpunkt. */
  readonly resource: string;
  readonly databaseUrl: string;
  /** 32-Byte-Schlüssel (AES-256) für die Refresh-Token-Verschlüsselung. */
  readonly encryptionKey: Buffer;
  readonly google: GoogleConfig;
  readonly googleScopes: readonly string[];
}

const DEFAULT_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/webmasters.readonly"];

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Pflicht-Umgebungsvariable fehlt: ${key}`);
  return value;
}

/** Liest einen 32-Byte-Schlüssel als base64 oder hex. */
function parseKey(raw: string): Buffer {
  for (const encoding of ["base64", "hex"] as const) {
    try {
      const buf = Buffer.from(raw, encoding);
      if (buf.length === 32) return buf;
    } catch {
      // nächste Kodierung versuchen
    }
  }
  throw new Error("ENCRYPTION_KEY muss 32 Byte sein (base64 oder hex).");
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const issuer = required(env, "ISSUER").replace(/\/$/, "");
  const port = Number(env.PORT ?? "8080");
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Ungültiger PORT: ${env.PORT}`);

  return {
    port,
    issuer,
    resource: `${issuer}/mcp`,
    databaseUrl: required(env, "DATABASE_URL"),
    encryptionKey: parseKey(required(env, "ENCRYPTION_KEY")),
    google: {
      clientId: required(env, "GOOGLE_CLIENT_ID"),
      clientSecret: required(env, "GOOGLE_CLIENT_SECRET"),
      redirectUri: env.GOOGLE_REDIRECT_URI ?? `${issuer}/oauth/google/callback`,
    },
    googleScopes: env.GOOGLE_SCOPES ? env.GOOGLE_SCOPES.split(/\s+/).filter(Boolean) : DEFAULT_SCOPES,
  };
}
