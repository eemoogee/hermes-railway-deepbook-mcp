import type { AppState } from '../client.js';
import { readEnv } from '../config.js';

/** GitHub repo holding the Muneo reports, e.g. sm33f3r/muneo. GITHUB_REPO is the older name for MUNEO_REPO. */
function muneoRepo(): string | undefined {
  return readEnv('MUNEO_REPO')?.trim() || readEnv('GITHUB_REPO')?.trim() || undefined;
}

// Common handler signature for all muneo tools
export type MuneoHandler = (
  args: Record<string, unknown>,
  state: AppState
) => Promise<{ content: { type: string; text: string }[] }>;

const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 100;

/**
 * Daily report names end in _YYYYMMDD_HHMMSS, so sorting by that suffix puts the
 * newest first across tokens (plain name order would list every SUI report before any SOL one).
 * Rollups (weekly_2026_W39.json, monthly_2026_M09.json) already sort by name.
 */
function sortKey(name: string): string {
  const stamp = /(\d{8}_\d{6})\.json$/.exec(name);
  return stamp ? `${stamp[1]} ${name}` : name;
}

// Tool 1: muneo_list_reports
async function muneoListReportsHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  const path = args.path as string;

  if (!path || typeof path !== 'string') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'path parameter is required and must be a string'
        }, null, 2)
      }]
    };
  }

  const MUNEO_REPO = muneoRepo();
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  if (!MUNEO_REPO) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'MUNEO_REPO environment variable is required (the GitHub repo holding the Muneo reports, e.g. sm33f3r/muneo)'
        }, null, 2)
      }]
    };
  }

  const url = `https://api.github.com/repos/${MUNEO_REPO}/contents/${encodeURIComponent(path)}`;

  // GITHUB_TOKEN is optional — the Muneo repo (sm33f3r/muneo) is public as of Sep 2026; auth is only used to raise the GitHub API rate limit from 60/hr to 5000/hr, not for access.
  const listHeaders: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'dulcibella-mcp'
  };
  if (GITHUB_TOKEN) {
    listHeaders['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(url, { headers: listHeaders });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'GitHub API error',
            status: response.status,
            message: errorText
          }, null, 2)
        }]
      };
    }

    const files = await response.json();
    if (!Array.isArray(files)) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `${path} is a file, not a directory` }, null, 2) }] };
    }

    // The reports directory holds hundreds of files; the full GitHub listing is too large to hand to the model
    const filter = typeof args.filter === 'string' ? args.filter.trim().toLowerCase() : '';
    const limit = Math.min(Math.max(Math.floor(Number(args.limit) || DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
    const matching = files
      .filter((f: any) => !filter || String(f.name).toLowerCase().includes(filter))
      .sort((a: any, b: any) => sortKey(b.name).localeCompare(sortKey(a.name)));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          path,
          filter: filter || null,
          total_matching: matching.length,
          showing: Math.min(limit, matching.length),
          order: 'newest first',
          files: matching.slice(0, limit).map((f: any) => ({
            name: f.name,
            type: f.type,
            download_url: f.download_url,
          })),
        }, null, 2)
      }]
    };
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to fetch directory listing',
          message: err instanceof Error ? err.message : String(err)
        }, null, 2)
      }]
    };
  }
}

// Tool 2: muneo_fetch_report
async function muneoFetchReportHandler(
  args: Record<string, unknown>,
  state: AppState
): Promise<{ content: { type: string; text: string }[] }> {
  const download_url = args.download_url as string;

  if (!download_url || typeof download_url !== 'string') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'download_url parameter is required and must be a string'
        }, null, 2)
      }]
    };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  // GITHUB_TOKEN is optional — the Muneo repo (sm33f3r/muneo) is public as of Sep 2026; auth is only used to raise the GitHub API rate limit from 60/hr to 5000/hr, not for access.
  const fetchHeaders: Record<string, string> = { 'User-Agent': 'dulcibella-mcp' };
  if (GITHUB_TOKEN) {
    fetchHeaders['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(download_url, { headers: fetchHeaders });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Failed to fetch report',
            status: response.status,
            message: errorText
          }, null, 2)
        }]
      };
    }

    const report = await response.json();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(report, null, 2)
      }]
    };
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to fetch report',
          message: err instanceof Error ? err.message : String(err)
        }, null, 2)
      }]
    };
  }
}

// Tool definitions
export const muneoTools = [
  {
    name: 'muneo_list_reports',
    description: 'List files in a directory of the Muneo market intelligence repository, newest first. Returns name and download_url for the newest `limit` files (default 10) plus the total count. Use `filter` to narrow by name, e.g. \'global\', \'sui\' or \'sol\'. Common paths: \'reports\' (daily global, SUI and SOL reports, named market_report_<scope>_<YYYYMMDD>_<HHMMSS>.json), \'context/<sui|sol|global>/accumulated/weekly\', \'.../monthly\', \'.../quarterly\'. Pass a download_url to muneo_fetch_report to read a report.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path within the repo, e.g. reports, context/sui/accumulated/weekly, context/global/accumulated/monthly',
        },
        filter: {
          type: 'string',
          description: 'Only include files whose name contains this text (case-insensitive), e.g. global, sui, sol, 20261011',
        },
        limit: {
          type: 'number',
          description: `How many of the newest files to return. Default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT}.`,
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'muneo_fetch_report',
    description: 'Fetch a Muneo market intelligence report by its download_url. Returns the full parsed JSON report. Get the download_url from muneo_list_reports. Daily reports include a signal_summary block with pre-computed directional signals across RSI, MACD, funding rate, TVL, and other indicators. Null signals mean data was unavailable — not neutral.',
    inputSchema: {
      type: 'object',
      properties: {
        download_url: {
          type: 'string',
          description: 'The direct download URL for the report file, as returned in the download_url field of a muneo_list_reports result',
        },
      },
      required: ['download_url'],
    },
  },
];

// Handler mapping
export const muneoHandlers: Record<string, MuneoHandler> = {
  muneo_list_reports: muneoListReportsHandler,
  muneo_fetch_report: muneoFetchReportHandler,
};