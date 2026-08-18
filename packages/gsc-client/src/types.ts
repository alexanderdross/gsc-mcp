/**
 * Typen der Search Console API, so weit sie GSC-MCP nutzt.
 * Bewusst schmal gehalten — nur die Felder, die die Pipeline verarbeitet.
 */

export type SearchType =
  | "web"
  | "image"
  | "video"
  | "news"
  | "discover"
  | "googleNews";

export type Dimension = "query" | "page" | "country" | "device" | "date" | "hour" | "searchAppearance";

export type DataState = "final" | "all" | "hourly_all";

export interface DimensionFilter {
  readonly dimension: Dimension;
  readonly operator: "equals" | "contains" | "notContains" | "includingRegex" | "excludingRegex";
  readonly expression: string;
}

export interface SearchAnalyticsRequest {
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string;
  readonly dimensions?: readonly Dimension[];
  readonly type?: SearchType;
  readonly dataState?: DataState;
  readonly dimensionFilterGroups?: ReadonlyArray<{
    readonly groupType?: "and";
    readonly filters: readonly DimensionFilter[];
  }>;
  readonly rowLimit?: number;
  readonly startRow?: number;
}

export interface SearchAnalyticsRow {
  readonly keys: readonly string[];
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
}

export interface Site {
  readonly siteUrl: string;
  readonly permissionLevel: string;
}

export interface Sitemap {
  readonly path: string;
  readonly lastSubmitted?: string;
  readonly lastDownloaded?: string;
  readonly isPending?: boolean;
  readonly isSitemapsIndex?: boolean;
  readonly type?: string;
  readonly warnings?: string;
  readonly errors?: string;
}

export interface UrlInspectionResult {
  readonly inspectionResultLink?: string;
  readonly indexStatusResult?: {
    readonly verdict?: string;
    readonly coverageState?: string;
    readonly robotsTxtState?: string;
    readonly indexingState?: string;
    readonly lastCrawlTime?: string;
    readonly pageFetchState?: string;
    readonly googleCanonical?: string;
    readonly userCanonical?: string;
  };
}
