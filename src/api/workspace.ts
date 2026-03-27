import { getToken } from './auth';

const WS_BASE = '/folding/ws-api';

let rpcId = 0;

interface RpcResponse<T> {
  result: T;
  error?: { code: number; message: string };
}

async function rpcCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const token = getToken();
  const res = await fetch(WS_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '1.1',
      method,
      params: [params],
      id: ++rpcId,
    }),
  });

  if (!res.ok) {
    throw new Error(`Workspace ${res.status}: ${await res.text().catch(() => '')}`);
  }

  const body = (await res.json()) as RpcResponse<T>;
  if (body.error) {
    throw new Error(`Workspace RPC: ${body.error.message}`);
  }
  return body.result;
}

// --- Types ---

/**
 * Workspace ObjectMeta is a 13-element tuple.
 * [0] name, [1] type, [2] path, [3] timestamp, [4] id,
 * [5] owner, [6] size, [7] user_metadata, [8] auto_metadata,
 * [9] user_perm, [10] global_perm, [11] shock_url, [12] error
 */
export type ObjectMeta = [
  string, string, string, string, string,
  string, number, Record<string, string>, Record<string, string>,
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
  userMetadata: Record<string, string>;
  autoMetadata: Record<string, string>;
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
  const result = await rpcCall<Record<string, ObjectMeta[]>>('ls', { paths: [path] });
  const entries = result[path] ?? [];
  return entries.map(parseObjectMeta);
}

/** Get workspace objects (with or without data). */
export async function wsGet(paths: string[], metadataOnly = false): Promise<Array<[WsObject, unknown]>> {
  const result = await rpcCall<Array<[ObjectMeta, unknown]>>('get', {
    objects: paths,
    metadata_only: metadataOnly,
  });
  return result.map(([meta, data]) => [parseObjectMeta(meta), data]);
}

/** Check if objects exist. */
export async function wsExists(paths: string[]): Promise<Record<string, boolean>> {
  return rpcCall<Record<string, boolean>>('objects_exist', { objects: paths });
}

/** Get a download URL for a workspace object. */
export async function wsGetDownloadUrl(path: string): Promise<string> {
  const result = await rpcCall<string>('get_download_url', { path });
  return result;
}

/** Create a workspace folder. */
export async function wsCreateFolder(path: string): Promise<WsObject> {
  const result = await rpcCall<ObjectMeta[]>('create', {
    objects: [[path, 'folder', {}, '']],
  });
  return parseObjectMeta(result[0]!);
}
