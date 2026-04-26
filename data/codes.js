// AVDC codes, labels, color rules
// All finding/procedure enumerations used across the extension

export const PD_STAGES = [
  { value: 'PD0', label: 'PD0', desc: 'Normal' },
  { value: 'PD1', label: 'PD1', desc: 'Gingivitis only' },
  { value: 'PD2', label: 'PD2', desc: 'Early periodontitis (<25%)' },
  { value: 'PD3', label: 'PD3', desc: 'Moderate periodontitis (25–50%)' },
  { value: 'PD4', label: 'PD4', desc: 'Advanced periodontitis (>50%)' },
];

export const TR_STAGES = [
  { value: 'TR1', label: 'TR1', desc: 'Mild — enamel/cementum only' },
  { value: 'TR2', label: 'TR2', desc: 'Moderate — dentine, not pulp' },
  { value: 'TR3', label: 'TR3', desc: 'Deep — into pulp, tooth intact' },
  { value: 'TR4', label: 'TR4', desc: 'Extensive — most structure lost' },
  { value: 'TR5', label: 'TR5', desc: 'Remnants only' },
];

export const TR_TYPES = [
  { value: 'T1', label: 'T1', desc: 'Focal/multifocal radiolucency, normal PDL' },
  { value: 'T2', label: 'T2', desc: 'Narrowed/absent PDL, decreased radiopacity' },
];

export const FRACTURE_TYPES = [
  { value: 'EI',   label: 'EI',   desc: 'Enamel infraction' },
  { value: 'EF',   label: 'EF',   desc: 'Enamel fracture' },
  { value: 'UCF',  label: 'UCF',  desc: 'Uncomplicated crown fracture' },
  { value: 'CCF',  label: 'CCF',  desc: 'Complicated crown fracture (pulp exposed)' },
  { value: 'UCRF', label: 'UCRF', desc: 'Uncomplicated crown-root fracture' },
  { value: 'CCRF', label: 'CCRF', desc: 'Complicated crown-root fracture' },
  { value: 'RF',   label: 'RF',   desc: 'Root fracture' },
];

export const FURCATION_GRADES = [
  { value: 'F0', label: 'F0', desc: 'No furcation involvement' },
  { value: 'F1', label: 'F1', desc: 'Probe <50% under crown' },
  { value: 'F2', label: 'F2', desc: 'Probe >50%, not through' },
  { value: 'F3', label: 'F3', desc: 'Through and through' },
];

export const MOBILITY_GRADES = [
  { value: 'M0', label: 'M0', desc: 'Physiologic only' },
  { value: 'M1', label: 'M1', desc: 'Increased, <1mm' },
  { value: 'M2', label: 'M2', desc: '≥1mm movement' },
  { value: 'M3', label: 'M3', desc: 'Axial displacement' },
];

export const EXTRACTION_TYPES = [
  { value: 'simple',   label: 'Simple',   desc: 'Non-surgical extraction' },
  { value: 'surgical', label: 'Surgical', desc: 'Requires sectioning/alveoloplasty' },
];

export const PERIO_PROCEDURES = [
  { value: 'PRO',   label: 'PRO',   desc: 'Professional cleaning (scaling + polish)' },
  { value: 'RP/C',  label: 'RP/C',  desc: 'Root planing — closed' },
  { value: 'RP/O',  label: 'RP/O',  desc: 'Root planing — open (with flap)' },
  { value: 'GC',    label: 'GC',    desc: 'Gingival curettage' },
  { value: 'Flap',  label: 'Flap',  desc: 'Periodontal flap surgery' },
];

// Color priority: index 0 = highest priority
export const COLOR_PRIORITY = [
  { condition: (t) => t.procedures?.extraction != null,                              color: 'extracted' },
  { condition: (t) => ['TR3','TR4','TR5'].includes(t.findings?.toothResorption?.stage), color: 'critical' },
  { condition: (t) => ['CCF','CCRF','RF'].includes(t.findings?.fracture),            color: 'critical' },
  { condition: (t) => ['TR1','TR2'].includes(t.findings?.toothResorption?.stage),    color: 'warning' },
  { condition: (t) => ['EI','EF','UCF','UCRF'].includes(t.findings?.fracture),       color: 'warning' },
  { condition: (t) => ['PD3','PD4'].includes(t.findings?.periodontal?.stage),        color: 'warning' },
  { condition: (t) => ['PD1','PD2'].includes(t.findings?.periodontal?.stage),        color: 'mild' },
  { condition: (t) => t.findings?.furcation && t.findings.furcation !== 'F0',        color: 'mild' },
  { condition: (t) => t.findings?.mobility && t.findings.mobility !== 'M0',          color: 'mild' },
];

export const COLORS = {
  normal:    '#E8E4DF',
  mild:      '#F1C40F',
  warning:   '#E67E22',
  critical:  '#E74C3C',
  extracted: '#4A90D9',
  missing:   '#374151',
  selected:  '#9B59B6',
  multisel:  '#1ABC9C',
};

export function getToothColor(toothData) {
  if (!toothData) return COLORS.normal;
  if (toothData.findings?.missing) return COLORS.missing;
  for (const rule of COLOR_PRIORITY) {
    if (rule.condition(toothData)) return COLORS[rule.color];
  }
  return COLORS.normal;
}

// Empty tooth state template
export function emptyToothState() {
  return {
    findings: {
      periodontal: { stage: null, probingDepths: { mesioBuccal: null, buccal: null, distoBuccal: null } },
      toothResorption: { stage: null, type: null },
      fracture: null,
      furcation: null,
      mobility: null,
      missing: false,
    },
    procedures: {
      extraction: null,
      periodontal: [],
    },
  };
}
