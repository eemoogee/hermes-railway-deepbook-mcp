import type { AppState } from '../client.js';

// Common handler signature for all muneo tools
export type MuneoHandler = (
  args: Record<string, unknown>,
  state: AppState
) => Promise<{ content: { type: string; text: string }[] }>;

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

  const GITHUB_REPO = process.env.GITHUB_REPO;
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  if (!GITHUB_REPO) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'GITHUB_REPO environment variable is required'
        }, null, 2)
      }]
    };
  }

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(path)}`;

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

    // Sort files alphabetically descending
    const sortedFiles = Array.isArray(files)
      ? files.sort((a: any, b: any) => b.name.localeCompare(a.name))
      : files;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          path,
          files: sortedFiles
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
    description: 'List the contents of a directory in the Muneo market intelligence repository. Returns an array of file objects including name, download_url, and sha. Use this to discover available reports before fetching. Common paths: \'reports\' (daily SUI and global), \'context/sui/accumulated/weekly\', \'context/sui/accumulated/monthly\', \'context/sui/accumulated/quarterly\', \'context/global/accumulated/weekly\', \'context/global/accumulated/monthly\', \'context/global/accumulated/quarterly\'. Sort returned filenames alphabetically descending to find the latest — filenames are designed to sort correctly.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path within the repo, e.g. reports, context/sui/accumulated/weekly, context/global/accumulated/monthly',
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