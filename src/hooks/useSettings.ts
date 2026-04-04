import { createContext, useContext, useState, useCallback, useEffect } from 'react';

/**
 * Workflow mode controls which CWL workflow(s) are used:
 *  - "unified"    → single `predict-structure` workflow; tool is an input param
 *  - "individual" → separate workflows per tool: boltz, chai, esmfold, alphafold
 */
export type WorkflowMode = 'unified' | 'individual';

/**
 * Color scheme controls the visual theme:
 *  - "teal" → current teal/cyan science palette (default)
 *  - "cepi" → CEPI Heritage navy/gold palette
 */
export type ColorScheme = 'teal' | 'cepi';

/** Canonical workflow names registered in GoWe. */
export const UNIFIED_WORKFLOW = 'protein-structure-prediction';

export const TOOL_WORKFLOWS: Record<string, string> = {
  boltz: 'boltz-report',
  chai: 'chai-report',
  alphafold: 'alphafold-report',
  esmfold: 'esmfold-report',
};

/** All individual workflow names (for filtering jobs). */
export const ALL_INDIVIDUAL_WORKFLOWS = Object.values(TOOL_WORKFLOWS);

/** All workflow names relevant to this app (for filtering the jobs list). */
export function relevantWorkflows(mode: WorkflowMode): string[] {
  return mode === 'unified' ? [UNIFIED_WORKFLOW] : ALL_INDIVIDUAL_WORKFLOWS;
}

/** All known CWL tool workflow names. */
export const CWL_TOOLS = [
  'protein-structure-prediction',
  'predict-structure',
  'alphafold',
  'boltz',
  'chai',
  'esmfold',
  'protein-compare',
  'select-structure',
] as const;

/** All known CWL report workflow names. */
export const CWL_REPORT_WORKFLOWS = [
  'predict-report',
  'alphafold-report',
  'boltz-report',
  'boltz-report-msa',
  'chai-report',
  'esmfold-report',
] as const;

/** Union of all known workflow names (tools + reports) for filtering the jobs list. */
export const ALL_KNOWN_WORKFLOWS: string[] = [...CWL_TOOLS, ...CWL_REPORT_WORKFLOWS];

// ---------- Per-tool CWL input mapping ----------

interface ToolInputMap {
  workflow: string;
  inputFile: string;       // CWL input name for the FASTA file
  inputFileType: 'File' | 'File[]'; // some tools expect array
  numSamples?: string;
  numRecycles?: string;
  outputDir: string;
  outputFormat?: string;
  seed?: string;
  device?: string;
  samplingSteps?: string;
}

/** Maps each tool to its CWL input names. */
export const TOOL_INPUT_MAP: Record<string, ToolInputMap> = {
  boltz: {
    workflow: 'boltz-report',
    inputFile: 'input_file',
    inputFileType: 'File',
    numSamples: 'diffusion_samples',
    numRecycles: 'recycling_steps',
    outputDir: 'output_dir',
    outputFormat: 'output_format',
    samplingSteps: 'sampling_steps',
  },
  chai: {
    workflow: 'chai-report',
    inputFile: 'input_fasta',
    inputFileType: 'File',
    numSamples: 'num_diffn_samples',
    numRecycles: 'num_trunk_recycles',
    outputDir: 'output_directory',
    seed: 'seed',
    device: 'device',
    samplingSteps: 'num_diffn_timesteps',
  },
  alphafold: {
    workflow: 'alphafold-report',
    inputFile: 'fasta_paths',
    inputFileType: 'File',
    numRecycles: undefined,
    outputDir: 'output_dir',
    seed: 'random_seed',
  },
  esmfold: {
    workflow: 'esmfold-report',
    inputFile: 'sequences',
    inputFileType: 'File',
    numRecycles: 'num_recycles',
    outputDir: 'output_dir',
  },
};

// ---------- Context ----------

export interface SettingsContextValue {
  workflowMode: WorkflowMode;
  setWorkflowMode: (mode: WorkflowMode) => void;
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
}

const SETTINGS_KEY = 'app_settings';

interface StoredSettings {
  workflowMode?: string;
  colorScheme?: string;
}

function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as StoredSettings;
  } catch { /* ignore */ }
  return {};
}

function loadMode(): WorkflowMode {
  const s = loadSettings();
  return s.workflowMode === 'individual' ? 'individual' : 'unified';
}

function loadScheme(): ColorScheme {
  const s = loadSettings();
  return s.colorScheme === 'cepi' ? 'cepi' : 'teal';
}

function saveSettings(settings: StoredSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applyTheme(scheme: ColorScheme) {
  document.documentElement.dataset.theme = scheme;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be inside SettingsProvider');
  return ctx;
}

export function useSettingsProvider(): { value: SettingsContextValue } {
  const [workflowMode, setModeState] = useState<WorkflowMode>(loadMode);
  const [colorScheme, setSchemeState] = useState<ColorScheme>(loadScheme);

  // Apply theme on initial mount
  useEffect(() => {
    applyTheme(colorScheme);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setWorkflowMode = useCallback((mode: WorkflowMode) => {
    setModeState(mode);
    saveSettings({ workflowMode: mode, colorScheme });
  }, [colorScheme]);

  const setColorScheme = useCallback((scheme: ColorScheme) => {
    setSchemeState(scheme);
    applyTheme(scheme);
    saveSettings({ workflowMode, colorScheme: scheme });
  }, [workflowMode]);

  return { value: { workflowMode, setWorkflowMode, colorScheme, setColorScheme } };
}
