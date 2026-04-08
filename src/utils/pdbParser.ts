/**
 * Lightweight PDB parser for client-side structure analysis.
 *
 * Extracts C-alpha coordinates, sequence, B-factors (pLDDT), and
 * basic chain information from PDB format text. No external dependencies.
 */

export interface PdbResidue {
  chainId: string;
  resNum: number;
  resName: string;
  caCoord: [number, number, number];
  bFactor: number;  // pLDDT for predicted structures
}

export interface ParsedPdb {
  residues: PdbResidue[];
  /** C-alpha coordinates as [x, y, z] array. */
  caCoords: [number, number, number][];
  /** B-factor / pLDDT values per residue. */
  bFactors: number[];
  /** One-letter amino acid sequence. */
  sequence: string;
  /** Unique chain IDs. */
  chains: string[];
  /** Number of residues. */
  nResidues: number;
}

// Standard 3-letter to 1-letter mapping
const AA3TO1: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
  GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
  SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  // Non-standard
  MSE: 'M', UNK: 'X', SEC: 'U', PYL: 'O',
};

/**
 * Parse PDB text and extract C-alpha atom records.
 *
 * PDB format columns (1-indexed, fixed width):
 *   1-6:   Record type (ATOM/HETATM)
 *   7-11:  Atom serial number
 *   13-16: Atom name
 *   17:    Alternate location
 *   18-20: Residue name
 *   22:    Chain ID
 *   23-26: Residue sequence number
 *   27:    Code for insertion of residues
 *   31-38: X coordinate
 *   39-46: Y coordinate
 *   47-54: Z coordinate
 *   55-60: Occupancy
 *   61-66: B-factor (temperature factor / pLDDT)
 */
export function parsePdb(text: string): ParsedPdb {
  const residues: PdbResidue[] = [];
  const seen = new Set<string>(); // "chainId:resNum" dedup

  const lines = text.split('\n');
  for (const line of lines) {
    const recType = line.substring(0, 6).trim();
    if (recType !== 'ATOM' && recType !== 'HETATM') continue;

    const atomName = line.substring(12, 16).trim();
    if (atomName !== 'CA') continue;

    // Skip alternate locations (keep only first)
    const altLoc = line[16];
    if (altLoc && altLoc !== ' ' && altLoc !== 'A') continue;

    const resName = line.substring(17, 20).trim();
    const chainId = line[21] ?? ' ';
    const resNum = parseInt(line.substring(22, 26).trim(), 10);

    // Dedup: same chain + residue number
    const key = `${chainId}:${resNum}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const x = parseFloat(line.substring(30, 38));
    const y = parseFloat(line.substring(38, 46));
    const z = parseFloat(line.substring(46, 54));
    const bFactor = parseFloat(line.substring(60, 66)) || 0;

    if (isNaN(x) || isNaN(y) || isNaN(z)) continue;

    residues.push({
      chainId,
      resNum,
      resName,
      caCoord: [x, y, z],
      bFactor,
    });
  }

  const caCoords = residues.map((r) => r.caCoord);
  const bFactors = residues.map((r) => r.bFactor);
  const sequence = residues.map((r) => AA3TO1[r.resName] ?? 'X').join('');
  const chains = [...new Set(residues.map((r) => r.chainId))];

  return {
    residues,
    caCoords,
    bFactors,
    sequence,
    chains,
    nResidues: residues.length,
  };
}

/**
 * Parse mmCIF / PDBx text and extract C-alpha atom records.
 *
 * mmCIF uses a `loop_` block with `_atom_site.*` column headers
 * followed by whitespace-delimited data rows. We identify columns
 * dynamically so column order doesn't matter.
 */
export function parseCif(text: string): ParsedPdb {
  const residues: PdbResidue[] = [];
  const seen = new Set<string>();

  // Find the _atom_site loop block
  const lines = text.split('\n');
  let inAtomSite = false;
  let inData = false;
  const colNames: string[] = [];
  const colIndex: Record<string, number> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect start of _atom_site loop
    if (trimmed === 'loop_') {
      // Reset — a new loop block starts
      if (inAtomSite && inData) break; // we already parsed atom_site data
      inAtomSite = false;
      inData = false;
      colNames.length = 0;
      continue;
    }

    // Collect _atom_site column headers
    if (trimmed.startsWith('_atom_site.')) {
      inAtomSite = true;
      inData = false;
      const colName = trimmed.split(/\s+/)[0]!;
      colIndex[colName] = colNames.length;
      colNames.push(colName);
      continue;
    }

    // If we were reading _atom_site headers and hit a non-header line, we're in data
    if (inAtomSite && !trimmed.startsWith('_') && trimmed !== '' && trimmed !== '#') {
      inData = true;
    }

    // If we're in data mode but hit a new category or loop, stop
    if (inData && (trimmed.startsWith('_') || trimmed === 'loop_' || trimmed === '#')) {
      break;
    }

    if (!inData || trimmed === '') continue;

    // Parse data row — handle quoted values
    const fields = parseCifRow(trimmed);
    if (fields.length < colNames.length) continue;

    // Extract relevant fields
    const groupPDB = fields[colIndex['_atom_site.group_PDB'] ?? -1];
    if (groupPDB !== 'ATOM' && groupPDB !== 'HETATM') continue;

    // Atom name: prefer label_atom_id, fall back to auth_atom_id
    const atomName = (
      fields[colIndex['_atom_site.label_atom_id'] ?? -1] ??
      fields[colIndex['_atom_site.auth_atom_id'] ?? -1] ?? ''
    ).replace(/"/g, '');
    if (atomName !== 'CA') continue;

    // Alternate location
    const altId = fields[colIndex['_atom_site.label_alt_id'] ?? -1] ?? '.';
    if (altId !== '.' && altId !== '?' && altId !== 'A') continue;

    // Residue name
    const resName = (
      fields[colIndex['_atom_site.label_comp_id'] ?? -1] ??
      fields[colIndex['_atom_site.auth_comp_id'] ?? -1] ?? 'UNK'
    ).replace(/"/g, '');

    // Chain ID: prefer auth_asym_id for consistency with PDB
    const chainId = (
      fields[colIndex['_atom_site.auth_asym_id'] ?? -1] ??
      fields[colIndex['_atom_site.label_asym_id'] ?? -1] ?? ' '
    ).replace(/"/g, '');

    // Residue number: prefer auth_seq_id
    const resNumStr = fields[colIndex['_atom_site.auth_seq_id'] ?? -1] ??
      fields[colIndex['_atom_site.label_seq_id'] ?? -1] ?? '0';
    const resNum = parseInt(resNumStr, 10);

    // Coordinates
    const x = parseFloat(fields[colIndex['_atom_site.Cartn_x'] ?? -1] ?? '');
    const y = parseFloat(fields[colIndex['_atom_site.Cartn_y'] ?? -1] ?? '');
    const z = parseFloat(fields[colIndex['_atom_site.Cartn_z'] ?? -1] ?? '');

    // B-factor / pLDDT
    const bStr = fields[colIndex['_atom_site.B_iso_or_equiv'] ?? -1] ??
      fields[colIndex['_atom_site.B_factor'] ?? -1] ?? '0';
    const bFactor = parseFloat(bStr) || 0;

    if (isNaN(x) || isNaN(y) || isNaN(z)) continue;

    const key = `${chainId}:${resNum}`;
    if (seen.has(key)) continue;
    seen.add(key);

    residues.push({ chainId, resNum, resName, caCoord: [x, y, z], bFactor });
  }

  const caCoords = residues.map((r) => r.caCoord);
  const bFactors = residues.map((r) => r.bFactor);
  const sequence = residues.map((r) => AA3TO1[r.resName] ?? 'X').join('');
  const chains = [...new Set(residues.map((r) => r.chainId))];

  return { residues, caCoords, bFactors, sequence, chains, nResidues: residues.length };
}

/** Parse a single mmCIF data row, respecting quoted strings. */
function parseCifRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    // Skip whitespace
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
    if (i >= line.length) break;

    if (line[i] === "'" || line[i] === '"') {
      // Quoted value
      const quote = line[i]!;
      i++;
      const start = i;
      while (i < line.length && line[i] !== quote) i++;
      fields.push(line.slice(start, i));
      i++; // skip closing quote
    } else {
      // Unquoted value
      const start = i;
      while (i < line.length && line[i] !== ' ' && line[i] !== '\t') i++;
      fields.push(line.slice(start, i));
    }
  }
  return fields;
}

/**
 * Parse a structure file, auto-detecting format from content or using
 * the provided format hint.
 */
export function parseStructure(text: string, format?: 'pdb' | 'cif'): ParsedPdb {
  // Auto-detect if no format hint: CIF files contain 'data_' or '_atom_site'
  const isCif = format === 'cif' ||
    (!format && (text.startsWith('data_') || text.includes('_atom_site.')));
  return isCif ? parseCif(text) : parsePdb(text);
}

/**
 * Detect whether a structure is predicted (pLDDT scores) or experimental (B-factors).
 *
 * Heuristic: predicted structures have B-factors in 0-100 range with mean > 30
 * and concentrated in typical pLDDT ranges. Experimental B-factors are typically
 * lower (0-80) with different distributions.
 */
export function isPredictedStructure(bFactors: number[]): boolean {
  if (bFactors.length === 0) return false;

  let sum = 0;
  let allInRange = true;
  for (const b of bFactors) {
    sum += b;
    if (b < 0 || b > 100) allInRange = false;
  }
  const mean = sum / bFactors.length;

  // Predicted structures: all values 0-100, mean typically 40-95
  return allInRange && mean > 30;
}
