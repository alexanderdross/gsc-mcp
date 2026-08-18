/**
 * Getippter Client für die Search Console API. Kapselt Authentifizierung,
 * Fehlerübersetzung ([errors.ts]), Backoff ([backoff.ts]) und Pagination
 * ([search-analytics.ts]) hinter wenigen Methoden.
 *
 * `fetchFn` und `tokenProvider` sind injizierbar — der Client lässt sich damit
 * vollständig ohne Netzwerk testen.
 */

import { classifyGscError } from "./errors.ts";
import { withRetry, type RetryOptions } from "./backoff.ts";
import { paginate, MAX_PAGE_SIZE, type Page } from "./search-analytics.ts";
import type {
  SearchAnalyticsRequest,
  SearchAnalyticsRow,
  Site,
  Sitemap,
  UrlInspectionResult,
} from "./types.ts";

/** Minimale fetch-Signatur, die der Client braucht (kompatibel mit global fetch). */
export type FetchFn = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface GscClientOptions {
  /** Liefert einen gültigen Google-Access-Token (der Server hält ihn im Cache). */
  readonly tokenProvider: () => Promise<string>;
  readonly fetchFn?: FetchFn;
  readonly retry?: RetryOptions;
  /** Überschreibbar für Tests/Sandbox. */
  readonly webmastersBase?: string;
  readonly inspectionBase?: string;
}

const DEFAULT_WEBMASTERS = "https://www.googleapis.com/webmasters/v3";
const DEFAULT_INSPECTION = "https://searchconsole.googleapis.com/v1";

export class GscClient {
  readonly #tokenProvider: () => Promise<string>;
  readonly #fetch: FetchFn;
  readonly #retry: RetryOptions;
  readonly #webmasters: string;
  readonly #inspection: string;

  constructor(opts: GscClientOptions) {
    this.#tokenProvider = opts.tokenProvider;
    this.#fetch = opts.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
    this.#retry = opts.retry ?? {};
    this.#webmasters = opts.webmastersBase ?? DEFAULT_WEBMASTERS;
    this.#inspection = opts.inspectionBase ?? DEFAULT_INSPECTION;
  }

  async #request<T>(method: string, url: string, body?: unknown): Promise<T> {
    return withRetry(async () => {
      const token = await this.#tokenProvider();
      const res = await this.#fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        let parsed: unknown;
        try {
          parsed = await res.json();
        } catch {
          parsed = undefined;
        }
        throw classifyGscError(res.status, parsed);
      }
      return (await res.json()) as T;
    }, this.#retry);
  }

  /** Eine einzelne Seite Search-Analytics-Daten (rowLimit/startRow werden honoriert). */
  async querySearchAnalytics(
    siteUrl: string,
    request: SearchAnalyticsRequest,
  ): Promise<SearchAnalyticsRow[]> {
    const url = `${this.#webmasters}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const res = await this.#request<{ rows?: SearchAnalyticsRow[] }>("POST", url, request);
    return res.rows ?? [];
  }

  /**
   * Iteriert vollständig über einen Search-Analytics-Request und liefert Seiten
   * einzeln (Cursor persistierbar). `rowLimit`/`startRow` des Requests werden von
   * der Pagination gesteuert und dürfen nicht vorbelegt sein.
   */
  iterateSearchAnalytics(
    siteUrl: string,
    request: Omit<SearchAnalyticsRequest, "rowLimit" | "startRow">,
    pageSize: number = MAX_PAGE_SIZE,
  ): AsyncGenerator<Page, void, unknown> {
    return paginate(
      (startRow, limit) =>
        this.querySearchAnalytics(siteUrl, { ...request, startRow, rowLimit: limit }),
      pageSize,
    );
  }

  async listSites(): Promise<Site[]> {
    const res = await this.#request<{ siteEntry?: Site[] }>("GET", `${this.#webmasters}/sites`);
    return res.siteEntry ?? [];
  }

  async listSitemaps(siteUrl: string): Promise<Sitemap[]> {
    const url = `${this.#webmasters}/sites/${encodeURIComponent(siteUrl)}/sitemaps`;
    const res = await this.#request<{ sitemap?: Sitemap[] }>("GET", url);
    return res.sitemap ?? [];
  }

  /** Reicht die Sitemap zur Indexierung ein (einziges schreibendes Tool, opt-in Scope). */
  async submitSitemap(siteUrl: string, sitemapUrl: string): Promise<void> {
    const url = `${this.#webmasters}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`;
    await this.#request<unknown>("PUT", url);
  }

  async inspectUrl(siteUrl: string, inspectionUrl: string): Promise<UrlInspectionResult> {
    const res = await this.#request<{ inspectionResult?: UrlInspectionResult }>(
      "POST",
      `${this.#inspection}/urlInspection/index:inspect`,
      { siteUrl, inspectionUrl },
    );
    return res.inspectionResult ?? {};
  }
}
