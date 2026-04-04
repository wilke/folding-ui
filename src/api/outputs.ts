/**
 * Helpers for parsing CWL-style submission outputs from GoWe.
 *
 * Output locations use `ws://` scheme for workspace-staged files:
 *   ws:///awilke@bvbrc/home/folder/file.pdb  →  /awilke@bvbrc/home/folder/file.pdb
 *
 * The parser iterates ALL output keys from the submission, classifies
 * files by extension and name patterns, and auto-assigns roles
 * (structure, report, confidence, metadata, analysis). No hardcoded
 * output key names — works with any CWL workflow.
 */

// --- CWL output types ---

export interface CwlFile {
  class: 'File';
  basename: string;
  location: string;
  size: number;
  checksum?: string;
  nameext?: string;
  nameroot?: string;
}

export interface CwlDirectory {
  class: 'Directory';
  basename: string;
  location: string;
  listing?: Array<CwlFile | CwlDirectory>;
}

export type CwlOutput = CwlFile | CwlDirectory;

// --- Parsed result ---

export interface OutputFile {
  name: string;
  wsPath: string;
  size: number;
  ext: string;
  /** Which submission output key this file came from. */
  outputKey: string;
  /** Parent directory chain for nested files, e.g. ['output', 'raw']. Empty for top-level. */
  dirPath: string[];
  /** SHA1 checksum from CWL, used for dedup. */
  checksum?: string;
}

export interface OutputDir {
  name: string;
  wsPath: string | null;
  outputKey: string;
  dirPath: string[];
  fileCount: number;
}

export interface InputFile {
  name: string;
  wsPath: string | null;
  inputKey: string;
}

export interface ParsedOutputs {
  reportPath: string | null;
  structurePath: string | null;
  structureFormat: 'pdb' | 'cif';
  confidencePath: string | null;
  metadataPath: string | null;
  analysisPath: string | null;
  allFiles: OutputFile[];
  allDirs: OutputDir[];
  inputFiles: InputFile[];
}

/** Convert a ws:// location to a workspace path. */
export function wsPathFromLocation(location: string): string | null {
  if (location.startsWith('ws:///')) return '/' + location.slice(6);
  if (location.startsWith('ws://')) return location.slice(5);
  return null;
}

/** Collected file with directory context. */
interface CollectedFile {
  file: CwlFile;
  dirPath: string[];
}

/** Collected directory. */
interface CollectedDir {
  dir: CwlDirectory;
  dirPath: string[];
  fileCount: number;
}

/** Recursively collect all File and Directory entries from a CWL output item. */
function collectEntries(
  item: CwlFile | CwlDirectory,
  dirPath: string[] = [],
): { files: CollectedFile[]; dirs: CollectedDir[] } {
  if (item.class === 'File') {
    return { files: [{ file: item, dirPath }], dirs: [] };
  }
  if (item.class === 'Directory') {
    const subPath = [...dirPath, item.basename];
    const files: CollectedFile[] = [];
    const dirs: CollectedDir[] = [];
    let fileCount = 0;
    if (item.listing) {
      for (const child of item.listing) {
        const sub = collectEntries(child, subPath);
        files.push(...sub.files);
        dirs.push(...sub.dirs);
        fileCount += sub.files.length;
      }
    }
    dirs.push({ dir: item, dirPath, fileCount });
    return { files, dirs };
  }
  return { files: [], dirs: [] };
}

/**
 * Parse submission outputs into structured paths for the UI.
 *
 * Iterates every key in the submission outputs object. For each:
 *  - File entries are classified by extension and name patterns
 *  - Directory entries are recursed to find nested files and subdirs
 *  - Roles (structure, report, confidence, metadata, analysis) are
 *    assigned by file characteristics, not output key names
 *  - Files are deduped by path within each output key
 *  - Each top-level output key is preserved so all CWL outputs are visible
 */
export function parseOutputs(outputs: Record<string, unknown>, inputs?: Record<string, unknown>): ParsedOutputs {
  const result: ParsedOutputs = {
    reportPath: null,
    structurePath: null,
    structureFormat: 'pdb',
    confidencePath: null,
    metadataPath: null,
    analysisPath: null,
    allFiles: [],
    allDirs: [],
    inputFiles: [],
  };

  // Track by outputKey+wsPath to avoid duplicates within the same output key
  const seen = new Set<string>();

  // Process every output key from the submission
  for (const [key, value] of Object.entries(outputs)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    if (!entry.class) continue;

    // Collect all files and directories from this output
    const { files, dirs } = collectEntries(entry as unknown as CwlFile | CwlDirectory);

    for (const { file: f, dirPath } of files) {
      const wsP = wsPathFromLocation(f.location);
      if (!wsP) continue;

      // Dedup: skip if same path already seen under same output key
      const dedupKey = key + '\0' + wsP;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const ext = f.nameext ?? '';
      const name = f.basename ?? '';

      result.allFiles.push({ name, wsPath: wsP, size: f.size ?? 0, ext, outputKey: key, dirPath, checksum: f.checksum });

      // Classify by role
      classifyFile(result, name, ext, wsP, key);
    }

    // Collect directories
    for (const { dir: d, dirPath, fileCount } of dirs) {
      const wsP = wsPathFromLocation(d.location);
      result.allDirs.push({ name: d.basename, wsPath: wsP, outputKey: key, dirPath, fileCount });
    }
  }

  // Extract input files from submission inputs
  if (inputs) {
    for (const [key, value] of Object.entries(inputs)) {
      extractInputFiles(result.inputFiles, key, value);
    }
  }

  return result;
}

/** Recursively extract CWL File entries from an input value (may be File, array of Files, etc). */
function extractInputFiles(into: InputFile[], key: string, value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) extractInputFiles(into, key, item);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (obj.class === 'File') {
    const name = (obj.basename as string) ?? (obj.path as string)?.split('/').pop() ?? key;
    const loc = obj.location as string | undefined;
    const wsP = loc ? wsPathFromLocation(loc) : null;
    into.push({ name, wsPath: wsP, inputKey: key });
  }
}

/** Assign a file to the appropriate role based on its name, extension, and output key. */
function classifyFile(
  result: ParsedOutputs,
  name: string,
  ext: string,
  wsPath: string,
  outputKey: string,
): void {
  const lower = name.toLowerCase();

  // Structure: .pdb or .cif files (prefer first match, prefer model_1)
  if (ext === '.pdb' || ext === '.cif') {
    if (!result.structurePath || lower.startsWith('model_')) {
      result.structurePath = wsPath;
      result.structureFormat = ext === '.cif' ? 'cif' : 'pdb';
    }
    return;
  }

  // HTML report: .html files
  if (ext === '.html') {
    if (!result.reportPath) {
      result.reportPath = wsPath;
    }
    return;
  }

  // JSON files: classify by name pattern or output key
  if (ext === '.json' || lower.endsWith('.json')) {
    // confidence.json
    if (lower === 'confidence.json') {
      result.confidencePath = wsPath;
      return;
    }

    // metadata.json
    if (lower === 'metadata.json') {
      result.metadataPath = wsPath;
      return;
    }

    // Analysis JSON: named analysis.json, or *_report.json, or output key contains
    // "analysis", "characterization_json", "analysis_data"
    if (
      lower === 'analysis.json' ||
      lower.endsWith('_report.json') ||
      outputKey.includes('analysis') ||
      outputKey.includes('characterization_json')
    ) {
      if (!result.analysisPath) {
        result.analysisPath = wsPath;
      }
      return;
    }
  }
}

/** Format bytes into human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/** Get display path for a file: includes directory context for nested files. */
export function displayPath(f: OutputFile): string {
  if (f.dirPath.length === 0) return f.name;
  return f.dirPath.join('/') + '/' + f.name;
}
