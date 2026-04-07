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
