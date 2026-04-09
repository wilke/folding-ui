/**
 * Detect whether pasted/uploaded content is protein, DNA, or RNA.
 * Uses amino-acid-exclusive letters (E, F, I, L, P, Q) to distinguish
 * protein from nucleotide sequences.
 */

export type SeqType = 'protein' | 'dna' | 'rna' | 'unknown';

export function detectSequenceType(raw: string): SeqType {
  if (raw.startsWith('workspace://')) return 'unknown';
  const cleaned = raw.replace(/^>.*$/gm, '').replace(/[\s\d]/g, '').toUpperCase();
  if (cleaned.length < 3) return 'unknown';

  // RNA: has U but not T
  if (cleaned.includes('U') && !cleaned.includes('T')) return 'rna';

  // Protein-exclusive letters not in nucleotide IUPAC codes
  if (/[EFIJLOPQZ]/.test(cleaned)) return 'protein';

  // All chars are nucleotide IUPAC → DNA
  if (/^[ATGCNRYSWKMBDHV]+$/.test(cleaned)) return 'dna';

  // All chars are valid amino acids → protein
  if (/^[ACDEFGHIKLMNPQRSTVWYX*]+$/.test(cleaned)) return 'protein';

  return 'unknown';
}
