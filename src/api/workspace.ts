import { getToken } from './auth';

const WS_BASE = '/folding/ws-api/';

let rpcId = 0;

interface RpcResponse<T> {
  result: T;
  error?: { code: number; message: string };
}

async function rpcCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const token = getToken();
  const reqBody = {
    jsonrpc: '1.1',
    method,
    params: [params],
    id: ++rpcId,
  };
  console.debug('[WS-RPC]', method, params, { hasToken: !!token, tokenPrefix: token?.slice(0, 30) });

  const res = await fetch(WS_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify(reqBody),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[WS-RPC] HTTP error', res.status, text.slice(0, 200));
    throw new Error(`Workspace ${res.status}: ${text}`);
  }

  const body = (await res.json()) as RpcResponse<T>;
  console.debug('[WS-RPC] response', JSON.stringify(body).slice(0, 500));
  if (body.error) {
    throw new Error(`Workspace RPC: ${body.error.message}`);
  }
  // JSON-RPC 1.1 wraps the result in an array: result: [data]
  const result = body.result;
  if (Array.isArray(result)) {
    if (result.length === 0) {
      throw new Error(`Workspace RPC ${method}: empty result array`);
    }
    return result[0] as T;
  }
  if (result == null) {
    throw new Error(`Workspace RPC ${method}: null/undefined result`);
  }
  return result;
}

// --- Types ---

/**
 * Workspace ObjectMeta is a 13-element tuple.
 * [0] name, [1] type, [2] path, [3] timestamp, [4] id,
 * [5] owner, [6] size, [7] user_metadata, [8] auto_metadata,
 * [9] user_perm, [10] global_perm, [11] shock_url, [12] error
 */
type MetaMap = Record<string, string | number>;

export type ObjectMeta = [
  string, string, string, string, string,
  string, number, MetaMap, MetaMap,
  string, string, string, string,
];

export interface WsObject {
  name: string;
  type: string;
  path: string;
  timestamp: string;
  id: string;
  owner: string;
  size: number;
  userMetadata: MetaMap;
  autoMetadata: MetaMap;
}

function parseObjectMeta(tuple: ObjectMeta): WsObject {
  return {
    name: tuple[0],
    type: tuple[1],
    path: tuple[2],
    timestamp: tuple[3],
    id: tuple[4],
    owner: tuple[5],
    size: tuple[6],
    userMetadata: tuple[7],
    autoMetadata: tuple[8],
  };
}

// --- Methods ---

/** List contents of a workspace directory. */
export async function wsLs(path: string): Promise<WsObject[]> {
  const result = await rpcCall<Record<string, ObjectMeta[]>>('Workspace.ls', { paths: [path] });
  const entries = result[path] ?? [];
  return entries.map(parseObjectMeta);
}

/** Get workspace objects (with or without data). */
export async function wsGet(paths: string[], metadataOnly = false): Promise<Array<[WsObject, unknown]>> {
  const result = await rpcCall<Array<[ObjectMeta, unknown]>>('Workspace.get', {
    objects: paths,
    metadata_only: metadataOnly,
  });
  return result.map(([meta, data]) => [parseObjectMeta(meta), data]);
}

/** Check if objects exist. */
export async function wsExists(paths: string[]): Promise<Record<string, boolean>> {
  return rpcCall<Record<string, boolean>>('Workspace.objects_exist', { objects: paths });
}

/** Get a download URL for a workspace object. */
export async function wsGetDownloadUrl(path: string): Promise<string> {
  const result = await rpcCall<string[]>('Workspace.get_download_url', { objects: [path] });
  // Result is an array of URLs; return the first one
  if (Array.isArray(result)) return result[0] ?? '';
  return result as unknown as string;
}

/** Create a workspace folder. */
export async function wsCreateFolder(path: string): Promise<WsObject> {
  const result = await rpcCall<ObjectMeta[]>('Workspace.create', {
    objects: [[path, 'folder', {}, '']],
  });
  if (!result || !Array.isArray(result) || result.length === 0) {
    throw new Error(`Workspace.create returned no objects for ${path}`);
  }
  return parseObjectMeta(result[0]!);
}

/** Create a workspace folder if it doesn't already exist. */
export async function wsEnsureFolder(path: string): Promise<void> {
  try {
    await wsCreateFolder(path);
  } catch (err) {
    // Ignore "already exists" errors — the API may return an error with
    // "exists/already" text, OR return an empty result array (no objects
    // created because the folder was already there).
    if (err instanceof Error && /exists|already|no objects/i.test(err.message)) return;
    throw err;
  }
}

/**
 * Upload text content to workspace as a file object.
 * Uses Workspace.create with inline data.
 * Returns the full workspace path of the created object.
 */
export async function wsUploadFile(
  destPath: string,
  content: string,
  type = 'unspecified',
): Promise<string> {
  await rpcCall<ObjectMeta[]>('Workspace.create', {
    objects: [[destPath, type, {}, content]],
    overwrite: true,
  });
  return destPath;
}
