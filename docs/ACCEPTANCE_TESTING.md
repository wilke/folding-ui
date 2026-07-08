# Predict Structure — Acceptance Testing Guide

**Version**: 0.1.x (feature/interactive-analysis merged)
**Target audience**: Mixed — biology domain experts and software QA testers
**Test environment**: Docker deployment at `http://localhost:8088/folding/` (or your configured host)

---

## 1. What is the Predict Structure Service?

**In one sentence**: A web application that lets scientists submit a protein, DNA, or RNA sequence and get back a predicted 3D structure — computed by one of four state-of-the-art AI models — plus a full quality report and interactive analysis tools.

### The pieces

| Component | Role |
|---|---|
| **Predict Structure UI** (this app) | React SPA — the browser interface testers will validate |
| **GoWe** | CWL v1.2 workflow engine — schedules and runs the prediction jobs |
| **BV-BRC Workspace** | Cloud file storage — inputs and outputs live here |
| **PredictStructureApp** | Python CLI that wraps the four prediction tools behind one interface |
| **Tool containers** | Boltz-2, Chai-1, AlphaFold 2, ESMFold — each in its own Docker image |

### The four prediction tools (short primer for QA testers)

- **Boltz-2** — Newest, fast, needs a Multiple Sequence Alignment (MSA). Supports protein + DNA/RNA/ligands.
- **Chai-1** — Also multi-molecular, needs MSA. Slightly different accuracy trade-offs.
- **AlphaFold 2** — The famous one. Generates its own MSA (slower). Protein only.
- **ESMFold** — Fastest. No MSA needed. Protein only. Lower accuracy than AF2.

**What's an MSA?** Multiple Sequence Alignment — a file listing many related sequences. Boltz/Chai use it as a hint for evolutionary conservation. AF2 builds its own. ESMFold doesn't need one.

**pLDDT** — Per-residue confidence score, 0–100. >90 = very high, 70–90 = confident, 50–70 = low, <50 = very low.

**pTM / ipTM** — Overall structure confidence (0–1). >0.8 = trust the fold; <0.5 = probably wrong.

**PAE** — Predicted Aligned Error, in Ångströms. Grid of expected position errors between every pair of residues.

### Two ways to use the app

- **Standard mode** — Guided 4-step wizard. Auto-picks the best tool. Right for most users.
- **Expert mode** — Direct access to per-tool workflows with every parameter exposed. For advanced users.

Toggle between them from the Settings dropdown (gear icon, top-right).

---

## 2. Before You Start Testing

- [ ] You have BV-BRC credentials (username + password)
- [ ] You can reach `http://localhost:8088/folding/` (or the configured URL)
- [ ] You know where to file bugs (link, tracker, or template — see §14)
- [ ] You have at least one small protein test sequence ready (e.g. Crambin, 46 aa)
- [ ] You have at least one DNA and one RNA test sequence
- [ ] For deep testing: a pre-computed MSA file (`.a3m`), a ligand CCD code (e.g. `ATP`), a SMILES string

**Rule of thumb for test data size**: Under 100 residues → fast (<5 min). 100–300 → medium (5–30 min). 300+ → could be an hour or more depending on the tool.

---

## 3. Authentication & Session (P0)

- [ ] **AC-1.1** Visiting `/folding/submit` without a token redirects to `/folding/login`
- [ ] **AC-1.2** Login form accepts valid BV-BRC credentials and redirects to `/folding/submit`
- [ ] **AC-1.3** Login form rejects invalid credentials with a clear error message
- [ ] **AC-1.4** After login, username appears in the header (or in Settings dropdown)
- [ ] **AC-1.5** Token persists across a full page reload (F5)
- [ ] **AC-1.6** Token persists across a browser tab close and reopen
- [ ] **AC-1.7** Logout button clears the token and returns user to `/folding/login`
- [ ] **AC-1.8** After token expiration, next protected action redirects to login (not a crash)
- [ ] **AC-1.9** Auth Token row in Settings shows a truncated token with a working Copy button

---

## 4. Header & Navigation (P1)

- [ ] **AC-2.1** Brand link "Predict Structure" returns to home from any page
- [ ] **AC-2.2** "Submit" nav link goes to `/folding/submit`
- [ ] **AC-2.3** "Jobs" nav link goes to `/folding/jobs`
- [ ] **AC-2.4** Active page is visually distinct in nav
- [ ] **AC-2.5** Settings dropdown opens on click, closes on click-outside
- [ ] **AC-2.6** Both color schemes (Teal Science, CEPI Heritage) apply immediately
- [ ] **AC-2.7** Color scheme choice persists across reloads
- [ ] **AC-2.8** Workflow Mode switch (Standard ↔ Expert) is reflected on the Submit page

---

## 5. Standard Mode Wizard (P0)

### 5.1 Step 1 — Sequence
- [ ] **AC-3.1** Paste a protein FASTA → "Detected: Protein" green badge appears
- [ ] **AC-3.2** Paste a DNA sequence (e.g. `>test\nATGCGTACGATCGATCGATCG…`) → "Detected: DNA" blue badge
- [ ] **AC-3.3** Paste an RNA sequence (contains U, no T) → "Detected: RNA" purple badge
- [ ] **AC-3.4** Paste ambiguous/junk (e.g. random letters) → "Detected: Unknown" grey badge
- [ ] **AC-3.5** Upload a `.fasta` file → contents appear in the textarea, badge updates
- [ ] **AC-3.6** "Browse Workspace" opens the workspace modal
- [ ] **AC-3.7** Selecting a file from workspace populates the input as `workspace://…`
- [ ] **AC-3.8** "Next" button is disabled when sequence is empty
- [ ] **AC-3.9** Sequence text survives navigating forward and back through wizard steps
- [ ] **AC-3.10** Very long sequence (500+ aa) does not visually break the layout

### 5.2 Step 2 — Components (Additional Entities)
- [ ] **AC-4.1** Can add a DNA entity (paste FASTA)
- [ ] **AC-4.2** Can add an RNA entity (upload file)
- [ ] **AC-4.3** Can add a ligand by CCD code (e.g. `ATP`)
- [ ] **AC-4.4** Can add a SMILES string
- [ ] **AC-4.5** Can add a glycan identifier
- [ ] **AC-4.6** Chip-style display for each added entity shows type + name
- [ ] **AC-4.7** Removing an entity works (X or trash icon)
- [ ] **AC-4.8** Entity count badge updates as entities are added/removed
- [ ] **AC-4.9** Step can be skipped entirely (all entities optional)

### 5.3 Step 3 — Alignment (MSA)
- [ ] **AC-5.1** Can paste MSA text
- [ ] **AC-5.2** Can upload `.a3m`, `.sto`, `.pqt` files
- [ ] **AC-5.3** Can pick MSA from workspace
- [ ] **AC-5.4** "Tool impact" info box updates when MSA is added/removed
- [ ] **AC-5.5** Step can be skipped (MSA is optional)

### 5.4 Step 4 — Review & Submit
- [ ] **AC-6.1** Tool selector shows all five options (auto/boltz/chai/alphafold/esmfold)
- [ ] **AC-6.2** With "auto", the prediction bar shows a specific tool and a reason
- [ ] **AC-6.3** Auto changes tool when MSA is toggled (e.g. `Boltz` with MSA vs `AlphaFold` without)
- [ ] **AC-6.4** Auto changes tool when device is CPU (should prefer ESMFold)
- [ ] **AC-6.5** Auto changes tool when non-protein entities present (excludes AF/ESM)
- [ ] **AC-6.6** Input Summary correctly reports sequence, entity count, MSA state
- [ ] **AC-6.7** Detected sequence type badge shown next to sequence line
- [ ] **AC-6.8** Output Folder field is prefilled with the user's home directory
- [ ] **AC-6.9** "Browse" opens workspace folder-picker mode
- [ ] **AC-6.10** Resource estimate (approximate) is shown
- [ ] **AC-6.11** **Preview** button shows the exact `POST /folding/api/v1/submissions` payload
- [ ] **AC-6.12** Preview JSON has correct entity routing — DNA → `inputs.dna`, RNA → `inputs.rna`, not `inputs.protein`
- [ ] **AC-6.13** Preview JSON has `report_format: "all"` (not user-selectable)
- [ ] **AC-6.14** Preview JSON does not reference an MSA server (removed by policy)
- [ ] **AC-6.15** **Submit Job** creates a submission and navigates to its job page
- [ ] **AC-6.16** Submitting without a sequence is prevented

---

## 6. Expert Mode — Advanced Submit (P1)

- [ ] **AC-7.1** Switching to Expert mode swaps the interface
- [ ] **AC-7.2** Tool selector chooses a single per-tool workflow (no "auto")
- [ ] **AC-7.3** Full parameter form is exposed for the selected tool
- [ ] **AC-7.4** **Boltz-2 parameters**: diffusion_samples, recycling_steps, sampling_steps, output_format, use_potentials, write_full_pae
- [ ] **AC-7.5** **Chai-1 parameters**: num_diffn_samples, num_trunk_recycles, num_diffn_timesteps, seed, constraint_path, template_hits_path
- [ ] **AC-7.6** **AlphaFold parameters**: model_preset, db_preset, random_seed, use_gpu_relax, use_precomputed_msas
- [ ] **AC-7.7** **ESMFold parameters**: num_recycles, chunk_size, max_tokens_per_batch, fp16, cpu_only
- [ ] **AC-7.8** "Reset" restores tool defaults
- [ ] **AC-7.9** Preview & Submit work identically to Standard mode
- [ ] **AC-7.10** MSA input is hidden for ESMFold (which doesn't use MSAs)

### 6.1 Boltz YAML Builder
- [ ] **AC-8.1** In Expert mode with Boltz + YAML Builder toggle, structured builder appears
- [ ] **AC-8.2** Can add multiple protein entities, auto-assigned chain IDs (A, B, C…)
- [ ] **AC-8.3** MSA mode toggle (auto / empty) per entity
- [ ] **AC-8.4** Cyclic flag can be toggled per entity
- [ ] **AC-8.5** Can add modifications (position + CCD code) to a protein
- [ ] **AC-8.6** Can add ligands as CCD or SMILES
- [ ] **AC-8.7** Constraints panel: can add covalent bonds, binding pockets, contacts
- [ ] **AC-8.8** Live YAML preview updates as entities change
- [ ] **AC-8.9** Generated YAML is valid Boltz v1 format (spot-check by copying into Boltz CLI)

---

## 7. Workspace Integration (P0)

- [ ] **AC-9.1** WorkspaceBrowser opens as a modal
- [ ] **AC-9.2** Breadcrumb shows current path
- [ ] **AC-9.3** `..` (parent) navigation works and returns to parent directory
- [ ] **AC-9.4** Folders show a folder icon; files show a file icon + size
- [ ] **AC-9.5** Clicking a folder opens it
- [ ] **AC-9.6** In file mode, clicking a file selects it and closes the modal
- [ ] **AC-9.7** In folder mode, "Select This Folder" confirms current path
- [ ] **AC-9.8** Empty folder shows "Empty folder" message (no crash)
- [ ] **AC-9.9** Unauthenticated browser attempt shows login prompt (not a crash)
- [ ] **AC-9.10** Submitting when input folder already exists does NOT fail (idempotent create)

---

## 8. Jobs List Page (P1)

- [ ] **AC-10.1** Table lists all user jobs
- [ ] **AC-10.2** Columns present: Job ID, Name, Workflow, Tool, State, Submitted, Runtime
- [ ] **AC-10.3** State pills filter (All / Running / Completed / Failed / Pending)
- [ ] **AC-10.4** Tool workflow pills filter results
- [ ] **AC-10.5** Report workflow pills filter results
- [ ] **AC-10.6** Page size selector (10/20/50/100) works
- [ ] **AC-10.7** Prev/Next pagination present at top AND bottom
- [ ] **AC-10.8** Empty result set shows a friendly "no jobs" message
- [ ] **AC-10.9** Auto-refresh triggers roughly every 10 s (or on SSE update)
- [ ] **AC-10.10** Clicking a job row navigates to its detail page

---

## 9. Job Detail Page (P0)

### 9.1 Overview tab
- [ ] **AC-11.1** Header shows job ID (short), state badge, LIVE badge (if streaming)
- [ ] **AC-11.2** Runtime updates while running; freezes on completion
- [ ] **AC-11.3** Workflow name is a link to GoWe API details
- [ ] **AC-11.4** Tool, submitted date, run name shown
- [ ] **AC-11.5** Inputs and Parameters JSON is collapsible
- [ ] **AC-11.6** Success banner appears for completed jobs
- [ ] **AC-11.7** Failure banner shows error code and message for failed jobs
- [ ] **AC-11.8** Cancel action works on running jobs

### 9.2 Report tab
- [ ] **AC-12.1** HTML report loads in an inline iframe
- [ ] **AC-12.2** "Open in new tab" link works
- [ ] **AC-12.3** For jobs without a report yet, a placeholder message shows

### 9.3 Tasks tab
- [ ] **AC-13.1** Task table lists each step with state, runtime, exit code
- [ ] **AC-13.2** Expanding a task shows stdout and stderr
- [ ] **AC-13.3** Task Progress bar reflects success/running/failed counts

### 9.4 Files tab
- [ ] **AC-14.1** Two sections: Inputs and Outputs
- [ ] **AC-14.2** Inputs listed with name, parameter name, download link
- [ ] **AC-14.3** Outputs grouped by output key
- [ ] **AC-14.4** File sizes shown in human-readable units
- [ ] **AC-14.5** Download links work

---

## 10. Results Tab (P0)

Available only for `success/completed` jobs.

- [ ] **AC-15.1** Molecule type badge (Protein/DNA/RNA) at top with description text
- [ ] **AC-15.2** AnalysisMetrics grid shows: Residues, Mol. Weight, Mean pLDDT, Confident %, pTM, Mean PAE, Contacts, Structure fractions
- [ ] **AC-15.3** For DNA/RNA jobs, "molecular weight" is either hidden or shown as 0 (not NaN)
- [ ] **AC-15.4** For DNA jobs, structure fractions section is appropriate (or omitted)
- [ ] **AC-15.5** 3D Structure viewer loads (3Dmol.js) with cartoon representation
- [ ] **AC-15.6** Structure color controls (Spectrum / pLDDT / Chain / Secondary) all work
- [ ] **AC-15.7** Render style controls (Cartoon / Stick / Sphere) all work
- [ ] **AC-15.8** For CIF-format outputs, viewer displays correctly (mmcif format)
- [ ] **AC-15.9** Download button provides the correct file (PDB or CIF)
- [ ] **AC-15.10** pLDDT chart shows per-residue confidence, colored by band
- [ ] **AC-15.11** Confidence card shows scalar scores (pTM, ipTM, confidence) with progress bars
- [ ] **AC-15.12** Metadata card shows run parameters
- [ ] **AC-15.13** Secondary Structure bar renders (H=red, E=blue, C=grey)
- [ ] **AC-15.14** Hovering SS bar shows residue number, SS type, pLDDT
- [ ] **AC-15.15** PAE matrix heatmap renders with domain overlays
- [ ] **AC-15.16** PAE hover tooltip shows residue pair and PAE value
- [ ] **AC-15.17** PAE click-to-zoom on domains, legend reset works
- [ ] **AC-15.18** Contact map renders (binary + heatmap modes)
- [ ] **AC-15.19** Contact map SS axis strips are colored
- [ ] **AC-15.20** Contact statistics summary shown (short/medium/long/very-long)
- [ ] **AC-15.21** Sequence Composition — protein: hydrophobic/polar/positive/negative/special bars
- [ ] **AC-15.22** Sequence Composition — DNA: purine/pyrimidine bars, per-base A/T/G/C breakdown
- [ ] **AC-15.23** Sequence Composition — RNA: A/U/G/C bases with U shown (not T)
- [ ] **AC-15.24** Glossary panel expands and shows term definitions

---

## 11. Compare Tab (P0)

- [ ] **AC-16.1** Compare tab is visible on completed jobs (even with only one output structure)
- [ ] **AC-16.2** Model A and Model B selectors are side-by-side
- [ ] **AC-16.3** **Source: This Job** — lists all structure files from current job
- [ ] **AC-16.4** **Source: Other Job** — lists only completed jobs (excluding current)
- [ ] **AC-16.5** Other Job search filters by name, ID, workflow
- [ ] **AC-16.6** Selecting a job shows its structure files
- [ ] **AC-16.7** "← Back to jobs" returns to job list
- [ ] **AC-16.8** **Source: Workspace** — opens the workspace file picker
- [ ] **AC-16.9** Workspace-picked `.cif` files parse and display correctly
- [ ] **AC-16.10** Workspace-picked `.pdb` files parse and display correctly
- [ ] **AC-16.11** Cα RMSD is displayed and non-zero for different structures
- [ ] **AC-16.12** For identical structures, RMSD is 0.00 Å
- [ ] **AC-16.13** Divergent regions table lists ranges with mean/max Å
- [ ] **AC-16.14** Superposition viewer shows both models overlaid (green + amber)
- [ ] **AC-16.15** Per-residue distance chart renders
- [ ] **AC-16.16** pLDDT overlay chart shows both models
- [ ] **AC-16.17** Mean pLDDT (A / B) combined box shown with color-coded values
- [ ] **AC-16.18** pLDDT ratio (A : B) box shown, normalized so larger side ≥ 1
- [ ] **AC-16.19** With only 1 structure available, prompt to add a second source
- [ ] **AC-16.20** Loading state shown while fetching structures

---

## 12. Accuracy & Validity Testing (P0 for domain testers)

### 12.1 Known-structure regression tests
Pick 3–5 well-characterized test proteins with published experimental structures:

- [ ] **AC-17.1** **Crambin** (PDB 1CRN, 46 aa) — Boltz gives Cα RMSD < 2 Å vs 1CRN
- [ ] **AC-17.2** **Ubiquitin** (PDB 1UBQ, 76 aa) — All four tools give Cα RMSD < 2 Å
- [ ] **AC-17.3** **Lysozyme** (PDB 1LYZ, 129 aa) — AF2 gives Cα RMSD < 1 Å
- [ ] **AC-17.4** **Small DNA test** — Boltz DNA-only prediction runs (Boltz supports nucleotide-only inputs)
- [ ] **AC-17.5** Confidence scores match expectations — high (>90 pLDDT) for well-studied proteins

### 12.2 Sequence-type routing (validate the recent fix)
- [ ] **AC-18.1** Paste DNA sequence in Standard mode → Preview shows `inputs.dna` (NOT `inputs.protein`)
- [ ] **AC-18.2** Paste RNA sequence → Preview shows `inputs.rna`
- [ ] **AC-18.3** Uploaded file appears in workspace under expected filename (dna.fasta, rna.fasta, protein.fasta)
- [ ] **AC-18.4** Predict tool receives the sequence via the correct `--protein` / `--dna` / `--rna` CLI flag (verify from task logs)

### 12.3 Report consistency
- [ ] **AC-19.1** Values in the Results tab match values in the HTML Report tab
- [ ] **AC-19.2** Number of residues matches across pLDDT chart, SS bar, PAE heatmap
- [ ] **AC-19.3** Contact statistics match visual contact map density
- [ ] **AC-19.4** analysis.json fields (pLDDT, PAE, contacts, SS) exist and are non-empty

### 12.4 Multi-model consistency (num_samples > 1)
- [ ] **AC-20.1** Requesting `num_samples: 5` produces 5 output structures
- [ ] **AC-20.2** All 5 models appear in the Compare tab "This Job" source
- [ ] **AC-20.3** Model-to-model RMSD is small for well-folded regions, higher for loops

---

## 13. Documentation & Discoverability (P1)

- [ ] **AC-21.1** README explains how to build, run, and access the app
- [ ] **AC-21.2** Glossary panel on Results tab explains pLDDT, PAE, pTM, contact map, SS
- [ ] **AC-21.3** Tooltips/help boxes present in the wizard
- [ ] **AC-21.4** Error messages are user-friendly (not raw stack traces)
- [ ] **AC-21.5** Confidence bands are color-coded and legend is visible
- [ ] **AC-21.6** File format expectations documented (FASTA header, MSA formats)
- [ ] **AC-21.7** First-time user can complete a submission without needing an admin
- [ ] **AC-21.8** All four tools have a short description users can find in the UI

---

## 14. Cross-Cutting & Edge Cases (P2)

- [ ] **AC-22.1** Very short sequence (< 20 aa) — either runs or fails gracefully
- [ ] **AC-22.2** Very long sequence (> 1000 aa) — either runs or produces a helpful "too long" error
- [ ] **AC-22.3** Duplicate submission with same folder — does not overwrite silently, does not crash
- [ ] **AC-22.4** Invalid characters in sequence — clear validation message
- [ ] **AC-22.5** Concurrent jobs from the same user — both run and appear in list
- [ ] **AC-22.6** Job cancellation mid-run — state moves to `cancelled`, tasks stop
- [ ] **AC-22.7** Browser tab left open for 1 hour — auth refreshes, SSE reconnects
- [ ] **AC-22.8** Slow network — loading spinners shown, no silent failures
- [ ] **AC-22.9** Workspace service 502 — user sees a clear error, not "undefined is not an object"
- [ ] **AC-22.10** Dark mode / light mode / CEPI theme all render legibly
- [ ] **AC-22.11** Mobile viewport (375 × 812) — layout does not break horizontally

---

## 15. Reporting Bugs

For each finding, capture:

- **Test ID** (e.g. AC-15.16)
- **Steps to reproduce** (numbered, precise)
- **Expected behavior**
- **Actual behavior**
- **Screenshot or screen recording**
- **Browser + version** (Chrome/Safari/Firefox, version)
- **Job ID** (if applicable)
- **Console errors** (F12 → Console tab)
- **Severity**: P0 (blocking), P1 (major), P2 (minor)

Attach the failing job's full ID so developers can inspect its outputs directly.

---

## 16. Brainstorming — Integration & Bigger Picture

This section is a starting point for a design conversation with stakeholders. Testers should evaluate whether each integration would smooth their real-world workflows.

### 16.1 BV-BRC Data Flow Integration

- **Genome → Fold**: From a BV-BRC genome browser, "Fold this protein" button on any protein feature. Auto-populates sequence.
- **Proteome batch**: From a genome's proteome page, "Fold selected proteins" bulk action → submits N jobs with sensible per-tool defaults.
- **Feature enrichment**: Predicted structures back-link into BV-BRC protein records (thumbnail in the feature page).
- **Comparative genomics**: Fold ortholog groups across strains → auto-populate the Compare tab with structures from related organisms.
- **Antimicrobial resistance targets**: BV-BRC's AMR gene lists → one-click structure prediction of resistance factors.
- **Virulence factor structural analysis**: Auto-fold virulence gene products from pathogen genomes; feed into vaccine design pipelines.

**Testers evaluate**: Can a biologist go from "I found an interesting protein in BV-BRC" to "I have its 3D structure" without leaving the browser or reformatting data?

### 16.2 Cross-Tool Workflows

- **Predict → Compare → Annotate**: After prediction, auto-suggest similar structures from a local library (Foldseek search) and populate Compare tab.
- **Predict → Dock**: Emit ligand-docking-ready outputs; hand off to AutoDock / Vina via a "Dock this" button.
- **Predict → MD**: Structure → energy minimization → short MD trajectory as an optional post-processing step.
- **Multi-tool ensemble**: Run the same sequence through all four tools; present a consensus Compare view showing agreement/disagreement.
- **Reference-guided prediction**: Provide an experimental PDB as a template constraint; measure improvement.
- **Iterative refinement**: Use the Compare tab's divergent regions to auto-suggest sampling more models in low-confidence regions.
- **Complex assembly pipeline**: Fold each subunit → predict complex → validate against known biophysics.

**Testers evaluate**: Where in their daily workflow do they currently switch tools? Are the seams painful?

### 16.3 Automation & Batch

- **Bulk submission**: Upload a CSV/FASTA of many sequences → auto-generate one job per row.
- **API-first submission**: Documented `POST /submissions` endpoint so power users can script it.
- **Notification hooks**: Email / Slack / webhook when a long job completes.
- **Scheduled re-runs**: Re-fold with newer tool versions on a schedule; auto-compare against previous run.
- **Cost / quota dashboard**: How much compute has this user consumed?

### 16.4 External Ecosystem Integration

- **AlphaFold DB lookups**: Before predicting, check if AF DB already has this UniProt ID — save compute, offer as reference.
- **PDB cross-reference**: If the sequence closely matches an existing PDB entry, offer that as a starting reference or comparison target.
- **UniProt integration**: Paste a UniProt accession → auto-fetch sequence and annotations.
- **ChimeraX / PyMOL export**: Download the predicted structure as a ChimeraX session (`.cxs`) or PyMOL session (`.pse`) with confidence coloring baked in.
- **ModelArchive submission**: Auto-package + submit a completed prediction to the ModelArchive community database.
- **Foldseek search**: "Find similar structures" button that queries the AlphaFold DB / PDB / ESM Atlas by structure, not sequence.
- **InterPro / Pfam domain overlay**: Annotate the pLDDT chart and 3D viewer with domain boundaries from InterPro.
- **Publication citation helper**: Auto-generate a methods paragraph citing the specific tool version, database version, and parameters used.

### 16.5 Anything Else? — Testing Perspective Additions

- **Reproducibility ledger**: Save the exact tool version, container digest, and database snapshot for every job so a result can be reproduced years later.
- **Provenance chain**: If a Compare tab result influences a decision, capture the full pipeline (which structures, which tool versions).
- **Shareable results**: Public URL for a completed job that a collaborator can view without a BV-BRC account.
- **Result versioning**: If a user re-runs with different parameters, present a version tree in the UI.
- **Trust indicators**: Prominent warnings when pLDDT is low, pTM < 0.5, or PAE domains suggest the structure is unreliable.
- **Feedback loop**: In-app button to flag a bad prediction — feeds back to tool developers.
- **Accessibility audit**: Screen reader support, keyboard navigation, WCAG 2.1 AA compliance.
- **Internationalization**: If BV-BRC is used globally, are error messages and units translated?

---

## 17. Sign-Off

Testers indicate acceptance status:

| Area | Owner | Status | Notes |
|---|---|---|---|
| Auth & Session | | ☐ Pass ☐ Fail ☐ N/A | |
| Standard Wizard | | ☐ Pass ☐ Fail ☐ N/A | |
| Expert Mode | | ☐ Pass ☐ Fail ☐ N/A | |
| Boltz YAML Builder | | ☐ Pass ☐ Fail ☐ N/A | |
| Workspace Integration | | ☐ Pass ☐ Fail ☐ N/A | |
| Jobs List | | ☐ Pass ☐ Fail ☐ N/A | |
| Job Detail | | ☐ Pass ☐ Fail ☐ N/A | |
| Results Tab | | ☐ Pass ☐ Fail ☐ N/A | |
| Compare Tab | | ☐ Pass ☐ Fail ☐ N/A | |
| Accuracy & Validity | | ☐ Pass ☐ Fail ☐ N/A | |
| Documentation | | ☐ Pass ☐ Fail ☐ N/A | |
| Edge Cases | | ☐ Pass ☐ Fail ☐ N/A | |

**Overall recommendation**: ☐ Ready for release ☐ Ready with minor fixes ☐ Not ready — significant work needed

**Signed**: ____________________  **Date**: ____________________
