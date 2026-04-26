// sidepanel.js — Main application logic
// Handles: SVG chart rendering, state management, findings panel, keyboard shortcuts,
//          Ezyvet bridge, export/import, settings

import { DOGS } from './data/dogs.js';
import { CATS } from './data/cats.js';
import {
  PD_STAGES, TR_STAGES, TR_TYPES, FRACTURE_TYPES,
  FURCATION_GRADES, MOBILITY_GRADES, EXTRACTION_TYPES,
  PERIO_PROCEDURES, COLORS, getToothColor, emptyToothState,
} from './data/codes.js';
import {
  getLicenceState, activateLicence, deactivateLicence,
  validateLicence, initTrial, trialDaysRemaining,
} from './licence.js';

// ── Dev mode: set to true to bypass licence gate ──────────────────────────
const DEV_MODE = false;

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── State ──────────────────────────────────────────────────────────────────
const State = {
  current: null,
  selectedTeeth: new Set(),
  undoStack: [],
  saveTimer: null,

  async load() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['chartState'], (res) => {
        if (res.chartState) {
          this.current = res.chartState;
        } else {
          this.current = this._emptyChart('dog');
        }
        resolve();
      });
    });
  },

  _emptyChart(species) {
    return {
      species,
      patientName: '',
      dateCreated: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      teeth: {},
    };
  },

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.current.lastModified = new Date().toISOString();
      chrome.storage.local.set({ chartState: this.current });
    }, 500);
  },

  pushUndo() {
    this.undoStack.push(JSON.stringify(this.current.teeth));
    if (this.undoStack.length > 50) this.undoStack.shift();
  },

  undo() {
    if (!this.undoStack.length) return false;
    this.current.teeth = JSON.parse(this.undoStack.pop());
    this.scheduleSave();
    return true;
  },

  setSpecies(species) {
    this.current.species = species;
    this.current.teeth = {};
    this.current.dateCreated = new Date().toISOString();
    this.selectedTeeth.clear();
    this.scheduleSave();
  },

  getToothData(id) {
    return this.current.teeth[id] || null;
  },

  ensureTooth(id) {
    if (!this.current.teeth[id]) {
      this.current.teeth[id] = emptyToothState();
    }
    return this.current.teeth[id];
  },

  updateTooth(id, updater) {
    this.pushUndo();
    const t = this.ensureTooth(id);
    updater(t);
    // Clean up: remove tooth entry if it's all empty
    if (this._isToothEmpty(this.current.teeth[id])) {
      delete this.current.teeth[id];
    }
    this.scheduleSave();
  },

  _isToothEmpty(t) {
    if (!t) return true;
    const f = t.findings;
    const p = t.procedures;
    return !f.periodontal.stage &&
           !f.periodontal.probingDepths.mesioBuccal &&
           !f.periodontal.probingDepths.buccal &&
           !f.periodontal.probingDepths.distoBuccal &&
           !f.toothResorption.stage &&
           !f.toothResorption.type &&
           !f.fracture &&
           !f.furcation &&
           !f.mobility &&
           !f.missing &&
           !p.extraction &&
           p.periodontal.length === 0;
  },

  clearTooth(id) {
    this.pushUndo();
    delete this.current.teeth[id];
    this.scheduleSave();
  },

  getColor(id) {
    return getToothColor(this.current.teeth[id]);
  },

  clearAll() {
    this.pushUndo();
    this.current.teeth = {};
    this.current.dateCreated = new Date().toISOString();
    this.selectedTeeth.clear();
    this.scheduleSave();
  },

  getTeethData() {
    return this.current.species === 'dog' ? DOGS : CATS;
  },

  setPatientName(name) {
    this.current.patientName = name;
    this.scheduleSave();
  },
};

// ── SVG Chart Renderer ─────────────────────────────────────────────────────

// Crown bounding box for root attachment + hit area
const CROWN_DIMS = {
  incisor:    { rx: 10, ry: 14 },
  canine:     { rx: 16, ry: 30 },
  premolar:   { rx: 14, ry: 19 },
  carnassial: { rx: 20, ry: 24 },
  molar:      { rx: 18, ry: 19 },
  'molar-sm': { rx: 14, ry: 16 },
};

function getToothCrownPath(tooth) {
  const up = tooth.jaw === 'upper';
  const y = v => up ? v : -v;
  switch (tooth.size) {
    case 'incisor':
      // Chisel shape — wider at top, slightly tapered
      return `M -9,${y(-13)} Q 0,${y(-14)} 9,${y(-13)} L 10,${y(13)} Q 0,${y(14)} -10,${y(13)} Z`;
    case 'canine':
      // Pointed fang — sharp tip, broad base
      return `M 0,${y(-29)} C -16,${y(-24)} -16,${y(5)} 0,${y(32)} C 16,${y(5)} 16,${y(-24)} 0,${y(-29)} Z`;
    case 'premolar':
      // Two-cusp shape
      return `M 0,${y(-19)} C -14,${y(-16)} -14,${y(8)} -11,${y(13)} Q -6,${y(23)} 0,${y(19)} Q 6,${y(23)} 11,${y(13)} C 14,${y(8)} 14,${y(-16)} 0,${y(-19)} Z`;
    case 'carnassial':
      // Three-cusp blade — largest tooth
      return `M 0,${y(-24)} C -19,${y(-22)} -20,${y(3)} -18,${y(15)} Q -11,${y(29)} -6,${y(24)} Q -1,${y(20)} 0,${y(23)} Q 1,${y(20)} 6,${y(24)} Q 11,${y(29)} 18,${y(15)} C 20,${y(3)} 19,${y(-22)} 0,${y(-24)} Z`;
    case 'molar':
      // Wide bumpy molar — four cusps implied by wavy occlusal edge
      return `M -18,${y(-18)} Q 0,${y(-19)} 18,${y(-18)} C 19,${y(-14)} 19,${y(8)} 15,${y(13)} Q 11,${y(22)} 6,${y(19)} Q 0,${y(23)} -6,${y(19)} Q -11,${y(22)} -15,${y(13)} C -19,${y(8)} -19,${y(-14)} -18,${y(-18)} Z`;
    case 'molar-sm':
      // Smaller molar variant
      return `M -14,${y(-15)} Q 0,${y(-16)} 14,${y(-15)} C 15,${y(-11)} 15,${y(6)} 13,${y(11)} Q 9,${y(19)} 3,${y(16)} Q 0,${y(19)} -3,${y(16)} Q -9,${y(19)} -13,${y(11)} C -15,${y(6)} -15,${y(-11)} -14,${y(-15)} Z`;
    default:
      return `M 0,${y(-16)} C -14,${y(-14)} -14,${y(14)} 0,${y(16)} C 14,${y(14)} 14,${y(-14)} 0,${y(-16)} Z`;
  }
}

// Root configurations by number of roots
function getRootPaths(tooth) {
  const { jaw, roots, size } = tooth;
  const dir = jaw === 'upper' ? -1 : 1; // upper roots go up (negative y)
  const ry = (CROWN_DIMS[size] || CROWN_DIMS.premolar).ry;
  const start = ry + 2;
  const len = size === 'carnassial' ? 28 : size === 'canine' ? 40 : 23;

  if (roots === 1) {
    return [`M 0,${dir * start} L 0,${dir * (start + len)}`];
  }
  if (roots === 2) {
    const spread = size === 'carnassial' ? 10 : 7;
    return [
      `M -${spread},${dir * start} L -${spread + 2},${dir * (start + len)}`,
      `M  ${spread},${dir * start} L  ${spread + 2},${dir * (start + len)}`,
    ];
  }
  if (roots === 3) {
    const spread = 12;
    return [
      `M 0,${dir * start} L 0,${dir * (start + len + 2)}`,
      `M -${spread},${dir * start} L -${spread + 2},${dir * (start + len)}`,
      `M  ${spread},${dir * start} L  ${spread + 2},${dir * (start + len)}`,
    ];
  }
  return [];
}

function createToothElement(tooth) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'tooth');
  g.setAttribute('data-tooth-id', tooth.id);
  g.setAttribute('transform', `translate(${tooth.svgX}, ${tooth.svgY})`);

  const dims = CROWN_DIMS[tooth.size] || CROWN_DIMS.premolar;

  // Root lines (behind crown)
  getRootPaths(tooth).forEach(d => {
    const line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('class', 'root-line');
    line.setAttribute('d', d);
    g.appendChild(line);
  });

  // Crown shape
  const crown = document.createElementNS(SVG_NS, 'path');
  crown.setAttribute('class', 'crown');
  crown.setAttribute('d', getToothCrownPath(tooth));
  crown.setAttribute('fill', COLORS.normal);
  crown.setAttribute('stroke', '#475569');
  crown.setAttribute('stroke-width', '1.5');
  g.appendChild(crown);

  // Tooth number label
  const labelY = tooth.jaw === 'upper' ? dims.ry + 13 : -(dims.ry + 13);
  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('class', 'tooth-label');
  label.setAttribute('x', 0);
  label.setAttribute('y', labelY);
  label.setAttribute('dominant-baseline', tooth.jaw === 'upper' ? 'hanging' : 'auto');
  label.textContent = tooth.id;
  g.appendChild(label);

  // Invisible hit area (larger for easier clicking)
  const hit = document.createElementNS(SVG_NS, 'ellipse');
  hit.setAttribute('class', 'crown-hit');
  hit.setAttribute('rx', dims.rx + 6);
  hit.setAttribute('ry', dims.ry + 10);
  hit.setAttribute('cx', 0);
  hit.setAttribute('cy', 0);
  g.appendChild(hit);

  return g;
}

function renderChart() {
  const svg = document.getElementById('dental-chart-svg');
  svg.innerHTML = '';

  // Midline
  const mid = document.createElementNS(SVG_NS, 'line');
  mid.setAttribute('class', 'midline');
  mid.setAttribute('x1', 450); mid.setAttribute('y1', 50);
  mid.setAttribute('x2', 450); mid.setAttribute('y2', 430);
  svg.appendChild(mid);

  // Quadrant labels
  const qlabels = [
    { text: 'UPPER RIGHT', x: 240, y: 38, anchor: 'middle' },
    { text: 'UPPER LEFT',  x: 660, y: 38, anchor: 'middle' },
    { text: 'LOWER RIGHT', x: 240, y: 440, anchor: 'middle' },
    { text: 'LOWER LEFT',  x: 660, y: 440, anchor: 'middle' },
  ];
  qlabels.forEach(ql => {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('class', 'quadrant-label');
    t.setAttribute('x', ql.x);
    t.setAttribute('y', ql.y);
    t.setAttribute('text-anchor', ql.anchor);
    t.textContent = ql.text;
    svg.appendChild(t);
  });

  // Teeth
  const teeth = State.getTeethData();
  teeth.forEach(tooth => {
    const el = createToothElement(tooth);
    svg.appendChild(el);
  });

  // Drag selection rectangle (always present, hidden until dragging)
  const dragRect = document.createElementNS(SVG_NS, 'rect');
  dragRect.setAttribute('id', 'drag-select-rect');
  dragRect.setAttribute('display', 'none');
  svg.appendChild(dragRect);

  applyAllColors();
}

function applyAllColors() {
  const teeth = State.getTeethData();
  teeth.forEach(tooth => {
    updateToothVisual(tooth.id);
  });
}

function updateToothVisual(id) {
  const g = document.querySelector(`[data-tooth-id="${id}"]`);
  if (!g) return;

  const toothData = State.getToothData(id);
  const color = getToothColor(toothData);
  const crown = g.querySelector('.crown');
  if (crown) crown.setAttribute('fill', color);

  // Missing class
  const isMissing = toothData?.findings?.missing;
  g.classList.toggle('missing', !!isMissing);

  // Extracted X overlay
  const existingX = g.querySelector('.extracted-x-group');
  if (existingX) existingX.remove();
  if (toothData?.procedures?.extraction) {
    const xg = document.createElementNS(SVG_NS, 'g');
    xg.setAttribute('class', 'extracted-x-group');
    const dims = CROWN_DIMS[State.getTeethData().find(t => t.id === id)?.size] || CROWN_DIMS.premolar;
    const s = Math.min(dims.rx, dims.ry) * 0.55;
    const l1 = document.createElementNS(SVG_NS, 'line');
    l1.setAttribute('class', 'extracted-x');
    l1.setAttribute('x1', -s); l1.setAttribute('y1', -s);
    l1.setAttribute('x2',  s); l1.setAttribute('y2',  s);
    const l2 = document.createElementNS(SVG_NS, 'line');
    l2.setAttribute('class', 'extracted-x');
    l2.setAttribute('x1',  s); l2.setAttribute('y1', -s);
    l2.setAttribute('x2', -s); l2.setAttribute('y2',  s);
    xg.appendChild(l1); xg.appendChild(l2);
    g.appendChild(xg);
  }

  // Selection classes
  g.classList.toggle('selected', State.selectedTeeth.size === 1 && State.selectedTeeth.has(id));
  g.classList.toggle('multi-selected', State.selectedTeeth.size > 1 && State.selectedTeeth.has(id));
}

// ── SVG Events ─────────────────────────────────────────────────────────────
let dragStart = null;
let isDragging = false;

function bindSVGEvents() {
  const svg = document.getElementById('dental-chart-svg');

  svg.addEventListener('mousedown', (e) => {
    const toothEl = e.target.closest('[data-tooth-id]');
    if (!toothEl) {
      // Start drag select
      const pt = svgPoint(svg, e);
      dragStart = pt;
      isDragging = false;
      return;
    }
  });

  svg.addEventListener('mousemove', (e) => {
    if (!dragStart) return;
    const pt = svgPoint(svg, e);
    const dx = Math.abs(pt.x - dragStart.x);
    const dy = Math.abs(pt.y - dragStart.y);
    if (dx > 5 || dy > 5) isDragging = true;

    if (isDragging) {
      const rect = document.getElementById('drag-select-rect');
      const x = Math.min(pt.x, dragStart.x);
      const y = Math.min(pt.y, dragStart.y);
      const w = Math.abs(pt.x - dragStart.x);
      const h = Math.abs(pt.y - dragStart.y);
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', w);
      rect.setAttribute('height', h);
      rect.setAttribute('display', 'block');

      // Highlight teeth within rect
      const teeth = State.getTeethData();
      teeth.forEach(tooth => {
        const inRect = tooth.svgX >= x && tooth.svgX <= x + w &&
                       tooth.svgY >= y && tooth.svgY <= y + h;
        const g = document.querySelector(`[data-tooth-id="${tooth.id}"]`);
        if (g) {
          g.classList.toggle('multi-selected', inRect);
          g.classList.remove('selected');
        }
      });
    }
  });

  svg.addEventListener('mouseup', (e) => {
    if (isDragging) {
      // Finalize drag selection
      const rect = document.getElementById('drag-select-rect');
      const rx = parseFloat(rect.getAttribute('x') || 0);
      const ry = parseFloat(rect.getAttribute('y') || 0);
      const rw = parseFloat(rect.getAttribute('width') || 0);
      const rh = parseFloat(rect.getAttribute('height') || 0);
      rect.setAttribute('display', 'none');

      const newSel = new Set();
      State.getTeethData().forEach(tooth => {
        if (tooth.svgX >= rx && tooth.svgX <= rx + rw &&
            tooth.svgY >= ry && tooth.svgY <= ry + rh) {
          newSel.add(tooth.id);
        }
      });
      State.selectedTeeth = newSel;
      applyAllColors();
      openDrawer();
    }

    dragStart = null;
    isDragging = false;
  });

  svg.addEventListener('click', (e) => {
    if (isDragging) return;
    const toothEl = e.target.closest('[data-tooth-id]');
    if (!toothEl) {
      if (!e.target.closest('#findings-drawer') && !e.target.closest('.fracture-popup')) {
        clearSelection();
      }
      return;
    }

    const id = parseInt(toothEl.getAttribute('data-tooth-id'), 10);

    if (e.shiftKey && State.selectedTeeth.size > 0) {
      // Shift+click: add/remove from multi-selection
      if (State.selectedTeeth.has(id)) {
        State.selectedTeeth.delete(id);
      } else {
        State.selectedTeeth.add(id);
      }
    } else {
      State.selectedTeeth.clear();
      State.selectedTeeth.add(id);
    }

    applyAllColors();
    openDrawer();
  });
}

function svgPoint(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function clearSelection() {
  State.selectedTeeth.clear();
  applyAllColors();
  closeDrawer();
}

// ── Findings Drawer ────────────────────────────────────────────────────────
function openDrawer() {
  const drawer = document.getElementById('findings-drawer');
  const sel = [...State.selectedTeeth];

  if (sel.length === 0) { closeDrawer(); return; }

  drawer.setAttribute('aria-hidden', 'false');
  drawer.classList.add('open');

  if (sel.length === 1) {
    renderSingleToothPanel(sel[0]);
  } else {
    renderMultiToothPanel(sel);
  }
}

function closeDrawer() {
  const drawer = document.getElementById('findings-drawer');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.classList.remove('open');
}

function renderSingleToothPanel(id) {
  const toothDef = State.getTeethData().find(t => t.id === id);
  if (!toothDef) return;

  document.getElementById('drawer-tooth-title').textContent =
    `${id} — ${toothDef.name}`;

  const body = document.getElementById('drawer-body');
  const data = State.getToothData(id) || emptyToothState();
  const f = data.findings;
  const p = data.procedures;
  const isMultiRoot = toothDef.roots > 1;

  body.innerHTML = '';

  // ── FINDINGS — 2-column grid layout ──
  const grid = document.createElement('div');
  grid.className = 'findings-grid';

  // ── Left column: Periodontal Disease ──
  const pdSection = document.createElement('div');
  pdSection.className = 'finding-section';
  pdSection.appendChild(makeSectionTitle('Periodontal Disease'));
  pdSection.appendChild(makeToggleGroup(
    PD_STAGES.map(s => s.value),
    f.periodontal.stage,
    (val) => {
      State.updateTooth(id, t => {
        t.findings.periodontal.stage = t.findings.periodontal.stage === val ? null : val;
      });
      renderSingleToothPanel(id);
      updateToothVisual(id);
      refreshSummary();
    },
    (val) => {
      const colors = { PD0: null, PD1: 'active-mild', PD2: 'active-mild', PD3: 'active-warning', PD4: 'active-warning' };
      return colors[val];
    }
  ));

  // Probing depths
  const probRow = document.createElement('div');
  probRow.className = 'probing-row';
  const probLabel = document.createElement('span');
  probLabel.className = 'probing-label';
  probLabel.textContent = 'Probe (mm):';
  probRow.appendChild(probLabel);
  const probInputs = document.createElement('div');
  probInputs.className = 'probing-inputs';
  [['mesioBuccal','MB'], ['buccal','B'], ['distoBuccal','DB']].forEach(([key, lbl]) => {
    const wrap = document.createElement('div');
    wrap.className = 'probing-input-wrap';
    const l = document.createElement('label');
    l.textContent = lbl;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = 0; inp.max = 30; inp.step = 1;
    inp.className = 'probing-input';
    inp.value = f.periodontal.probingDepths[key] ?? '';
    inp.placeholder = '–';
    inp.addEventListener('change', () => {
      const v = inp.value === '' ? null : parseInt(inp.value, 10);
      State.updateTooth(id, t => { t.findings.periodontal.probingDepths[key] = v; });
    });
    wrap.appendChild(l);
    wrap.appendChild(inp);
    probInputs.appendChild(wrap);
  });
  probRow.appendChild(probInputs);
  pdSection.appendChild(probRow);
  grid.appendChild(pdSection);

  // ── Right column: Tooth Resorption ──
  const trSection = document.createElement('div');
  trSection.className = 'finding-section';
  trSection.appendChild(makeSectionTitle('Tooth Resorption'));
  trSection.appendChild(makeToggleGroup(
    TR_STAGES.map(s => s.value),
    f.toothResorption.stage,
    (val) => {
      State.updateTooth(id, t => {
        t.findings.toothResorption.stage = t.findings.toothResorption.stage === val ? null : val;
      });
      renderSingleToothPanel(id);
      updateToothVisual(id);
      refreshSummary();
    },
    (val) => {
      const colors = { TR1: 'active-warning', TR2: 'active-warning', TR3: 'active-critical', TR4: 'active-critical', TR5: 'active-critical' };
      return colors[val];
    }
  ));
  const trTypeRow = document.createElement('div');
  trTypeRow.className = 'tr-type-row';
  const trTypeLabel = document.createElement('span');
  trTypeLabel.className = 'tr-type-label';
  trTypeLabel.textContent = 'Type:';
  trTypeRow.appendChild(trTypeLabel);
  trTypeRow.appendChild(makeToggleGroup(
    TR_TYPES.map(s => s.value),
    f.toothResorption.type,
    (val) => {
      State.updateTooth(id, t => {
        t.findings.toothResorption.type = t.findings.toothResorption.type === val ? null : val;
      });
      renderSingleToothPanel(id);
    }
  ));
  trSection.appendChild(trTypeRow);
  grid.appendChild(trSection);

  // ── Left column: Fracture ──
  const fxSection = document.createElement('div');
  fxSection.className = 'finding-section';
  fxSection.appendChild(makeSectionTitle('Fracture'));
  fxSection.appendChild(makeToggleGroup(
    FRACTURE_TYPES.map(s => s.value),
    f.fracture,
    (val) => {
      State.updateTooth(id, t => {
        t.findings.fracture = t.findings.fracture === val ? null : val;
      });
      renderSingleToothPanel(id);
      updateToothVisual(id);
      refreshSummary();
    },
    (val) => ['CCF','CCRF','RF'].includes(val) ? 'active-critical' : 'active-warning'
  ));
  grid.appendChild(fxSection);

  // ── Right column: Furcation + Mobility stacked ──
  const furcMobSection = document.createElement('div');
  furcMobSection.className = 'finding-section';

  const furcWrap = document.createElement('div');
  furcWrap.className = 'finding-section';
  furcWrap.appendChild(makeSectionTitle(`Furcation ${isMultiRoot ? '' : '(N/A)'}`));
  furcWrap.appendChild(makeToggleGroup(
    FURCATION_GRADES.map(s => s.value),
    f.furcation,
    isMultiRoot ? (val) => {
      State.updateTooth(id, t => {
        t.findings.furcation = t.findings.furcation === val ? null : val;
      });
      renderSingleToothPanel(id);
      updateToothVisual(id);
      refreshSummary();
    } : null,
    (val) => val !== 'F0' ? 'active-mild' : null,
    !isMultiRoot
  ));
  furcMobSection.appendChild(furcWrap);

  const mobWrap = document.createElement('div');
  mobWrap.className = 'finding-section';
  mobWrap.appendChild(makeSectionTitle('Mobility'));
  mobWrap.appendChild(makeToggleGroup(
    MOBILITY_GRADES.map(s => s.value),
    f.mobility,
    (val) => {
      State.updateTooth(id, t => {
        t.findings.mobility = t.findings.mobility === val ? null : val;
      });
      renderSingleToothPanel(id);
      updateToothVisual(id);
      refreshSummary();
    },
    (val) => val !== 'M0' ? 'active-mild' : null
  ));
  furcMobSection.appendChild(mobWrap);
  grid.appendChild(furcMobSection);

  // ── Left column: Missing + Extraction ──
  const leftBottomSection = document.createElement('div');
  leftBottomSection.className = 'finding-section';

  const missingRow = document.createElement('div');
  missingRow.className = 'missing-row';
  const missingCb = document.createElement('input');
  missingCb.type = 'checkbox';
  missingCb.id = 'cb-missing';
  missingCb.checked = !!f.missing;
  missingCb.addEventListener('change', () => {
    State.updateTooth(id, t => { t.findings.missing = missingCb.checked; });
    updateToothVisual(id);
    refreshSummary();
  });
  const missingLabel = document.createElement('label');
  missingLabel.htmlFor = 'cb-missing';
  missingLabel.textContent = 'Missing / Absent tooth';
  missingRow.appendChild(missingCb);
  missingRow.appendChild(missingLabel);
  leftBottomSection.appendChild(missingRow);

  leftBottomSection.appendChild(makeSectionTitle('Extraction'));
  leftBottomSection.appendChild(makeToggleGroup(
    EXTRACTION_TYPES.map(s => s.value),
    p.extraction,
    (val) => {
      State.updateTooth(id, t => {
        t.procedures.extraction = t.procedures.extraction === val ? null : val;
      });
      renderSingleToothPanel(id);
      updateToothVisual(id);
      refreshSummary();
    },
    () => 'active-extracted'
  ));
  grid.appendChild(leftBottomSection);

  // ── Right column: Perio Treatment ──
  const perioSec = document.createElement('div');
  perioSec.className = 'finding-section';
  perioSec.appendChild(makeSectionTitle('Perio Treatment'));
  perioSec.appendChild(makeToggleGroupMulti(
    PERIO_PROCEDURES.map(s => s.value),
    p.periodontal,
    (val, isActive) => {
      State.updateTooth(id, t => {
        if (isActive) {
          t.procedures.periodontal = t.procedures.periodontal.filter(v => v !== val);
        } else {
          if (!t.procedures.periodontal.includes(val)) t.procedures.periodontal.push(val);
        }
      });
      renderSingleToothPanel(id);
      refreshSummary();
    }
  ));
  grid.appendChild(perioSec);

  body.appendChild(grid);

  // ── Wire Clear Tooth button in drawer handle ──
  const clearBtn = document.getElementById('btn-clear-tooth');
  clearBtn.onclick = () => {
    State.clearTooth(id);
    renderSingleToothPanel(id);
    updateToothVisual(id);
    refreshSummary();
  };
}

function renderMultiToothPanel(ids) {
  document.getElementById('drawer-tooth-title').textContent =
    `${ids.length} teeth selected — applying to all`;

  const body = document.getElementById('drawer-body');
  body.innerHTML = '';

  // Use first selected tooth's data to show current state as reference
  const ref = State.getToothData(ids[0]) || emptyToothState();
  const f = ref.findings;
  const p = ref.procedures;
  // Multi-root only if ALL selected teeth are multi-root
  const teeth = State.getTeethData();
  const allMultiRoot = ids.every(id => (teeth.find(t => t.id === id)?.roots ?? 1) > 1);

  function applyAll(updater) {
    ids.forEach(id => { State.updateTooth(id, updater); updateToothVisual(id); });
    renderMultiToothPanel(ids);
    refreshSummary();
  }

  const div = document.createElement('div');

  // ── PERIODONTAL ──
  div.appendChild(makeSectionTitle('Periodontal Disease'));
  div.appendChild(makeToggleGroup(
    PD_STAGES.map(s => s.value), f.periodontal.stage,
    (val) => applyAll(t => { t.findings.periodontal.stage = t.findings.periodontal.stage === val ? null : val; }),
    (val) => val === 'PD0' ? 'active' : val === 'PD1' || val === 'PD2' ? 'active-mild' : val === 'PD3' ? 'active-warning' : 'active-critical'
  ));

  // Probing depths
  const probingRow = document.createElement('div');
  probingRow.className = 'probing-row';
  const probingLabel = document.createElement('span');
  probingLabel.className = 'probing-label';
  probingLabel.textContent = 'Probe depth (mm):';
  probingRow.appendChild(probingLabel);
  ['mesioBuccal', 'buccal', 'distoBuccal'].forEach((key, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'probing-input-wrap';
    const lbl = document.createElement('span');
    lbl.className = 'probing-sub';
    lbl.textContent = ['MB', 'B', 'DB'][i];
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = 0; inp.max = 20; inp.className = 'probing-input';
    inp.value = f.periodontal.probingDepths?.[key] ?? '';
    inp.addEventListener('change', () => {
      const v = inp.value === '' ? null : parseInt(inp.value, 10);
      applyAll(t => { t.findings.periodontal.probingDepths[key] = v; });
    });
    wrap.appendChild(lbl); wrap.appendChild(inp);
    probingRow.appendChild(wrap);
  });
  div.appendChild(probingRow);
  div.appendChild(makeHR());

  // ── TOOTH RESORPTION ──
  div.appendChild(makeSectionTitle('Tooth Resorption'));
  div.appendChild(makeToggleGroup(
    TR_STAGES.map(s => s.value), f.toothResorption.stage,
    (val) => applyAll(t => { t.findings.toothResorption.stage = t.findings.toothResorption.stage === val ? null : val; }),
    (val) => ['TR1','TR2'].includes(val) ? 'active-warning' : 'active-critical'
  ));
  const trTypeRow = document.createElement('div');
  trTypeRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:5px';
  const trTypeLabel = document.createElement('span');
  trTypeLabel.style.cssText = 'font-size:10px;color:var(--text-dim)';
  trTypeLabel.textContent = 'Type:';
  trTypeRow.appendChild(trTypeLabel);
  trTypeRow.appendChild(makeToggleGroup(
    ['T1', 'T2'], f.toothResorption.type,
    (val) => applyAll(t => { t.findings.toothResorption.type = t.findings.toothResorption.type === val ? null : val; })
  ));
  div.appendChild(trTypeRow);
  div.appendChild(makeHR());

  // ── FRACTURE ──
  div.appendChild(makeSectionTitle('Fracture'));
  div.appendChild(makeToggleGroup(
    FRACTURE_TYPES.map(s => s.value), f.fracture,
    (val) => applyAll(t => { t.findings.fracture = t.findings.fracture === val ? null : val; }),
    (val) => ['CCF','CCRF','RF'].includes(val) ? 'active-critical' : 'active-warning'
  ));
  div.appendChild(makeHR());

  // ── FURCATION + MOBILITY side by side ──
  const furcMobRow2 = document.createElement('div');
  furcMobRow2.className = 'finding-section-row';

  const furcSec2 = document.createElement('div');
  furcSec2.className = 'finding-section';
  furcSec2.appendChild(makeSectionTitle(allMultiRoot ? 'Furcation' : 'Furcation (N/A)'));
  furcSec2.appendChild(makeToggleGroup(
    FURCATION_GRADES.map(s => s.value), f.furcation,
    (val) => applyAll(t => { t.findings.furcation = t.findings.furcation === val ? null : val; }),
    (val) => val === 'F0' ? 'active' : 'active-mild',
    !allMultiRoot
  ));
  furcMobRow2.appendChild(furcSec2);

  const mobSec2 = document.createElement('div');
  mobSec2.className = 'finding-section';
  mobSec2.appendChild(makeSectionTitle('Mobility'));
  mobSec2.appendChild(makeToggleGroup(
    MOBILITY_GRADES.map(s => s.value), f.mobility,
    (val) => applyAll(t => { t.findings.mobility = t.findings.mobility === val ? null : val; }),
    (val) => val === 'M0' ? 'active' : 'active-mild'
  ));
  furcMobRow2.appendChild(mobSec2);

  div.appendChild(furcMobRow2);
  div.appendChild(makeHR());

  // ── MISSING ──
  const missingRow = document.createElement('div');
  missingRow.className = 'missing-row';
  const missingCb = document.createElement('input');
  missingCb.type = 'checkbox'; missingCb.id = 'cb-missing-multi';
  missingCb.checked = f.missing;
  missingCb.addEventListener('change', () => applyAll(t => { t.findings.missing = missingCb.checked; }));
  const missingLabel = document.createElement('label');
  missingLabel.htmlFor = 'cb-missing-multi';
  missingLabel.textContent = 'Missing / Absent tooth';
  missingRow.appendChild(missingCb); missingRow.appendChild(missingLabel);
  div.appendChild(missingRow);
  div.appendChild(makeHR());

  // ── PROCEDURES ──
  div.appendChild(makeSectionTitle('Procedures'));
  const procRow2 = document.createElement('div');
  procRow2.className = 'finding-section-row';

  const extSec2 = document.createElement('div');
  extSec2.className = 'finding-section';
  extSec2.appendChild(makeSectionTitle('Extraction'));
  extSec2.appendChild(makeToggleGroup(
    EXTRACTION_TYPES.map(s => s.value), p.extraction,
    (val) => applyAll(t => { t.procedures.extraction = t.procedures.extraction === val ? null : val; }),
    () => 'active-extracted'
  ));
  procRow2.appendChild(extSec2);

  const perioSec2 = document.createElement('div');
  perioSec2.className = 'finding-section';
  perioSec2.appendChild(makeSectionTitle('Perio Treatment'));
  perioSec2.appendChild(makeToggleGroupMulti(
    PERIO_PROCEDURES.map(s => s.value), p.periodontal,
    (val, isActive) => applyAll(t => {
      if (isActive) t.procedures.periodontal = t.procedures.periodontal.filter(v => v !== val);
      else if (!t.procedures.periodontal.includes(val)) t.procedures.periodontal.push(val);
    })
  ));
  procRow2.appendChild(perioSec2);

  div.appendChild(procRow2);

  body.appendChild(div);

  // Wire Clear button in drawer handle
  const clearBtn = document.getElementById('btn-clear-tooth');
  clearBtn.textContent = `Clear ${ids.length}`;
  clearBtn.onclick = () => {
    ids.forEach(id => { State.clearTooth(id); updateToothVisual(id); });
    renderMultiToothPanel(ids);
    refreshSummary();
  };
}

// ── UI Helpers ─────────────────────────────────────────────────────────────
function makeSectionTitle(text) {
  const d = document.createElement('div');
  d.className = 'finding-section-title';
  d.textContent = text;
  return d;
}

function makeHR() {
  const hr = document.createElement('hr');
  hr.className = 'drawer-divider';
  return hr;
}

// ── Tooltip lookup — maps code values to descriptions ─────────────────────
const CODE_TOOLTIPS = {};
[PD_STAGES, TR_STAGES, TR_TYPES, FRACTURE_TYPES, FURCATION_GRADES,
 MOBILITY_GRADES, EXTRACTION_TYPES, PERIO_PROCEDURES].forEach(list => {
  list.forEach(item => { CODE_TOOLTIPS[item.value] = item.desc; });
});

// Single-select toggle group
function makeToggleGroup(values, activeVal, onToggle, colorFn = null, disabled = false) {
  const group = document.createElement('div');
  group.className = 'toggle-group';
  values.forEach(val => {
    const btn = document.createElement('button');
    btn.className = 'toggle-btn';
    btn.textContent = val;
    if (CODE_TOOLTIPS[val]) btn.title = CODE_TOOLTIPS[val];
    if (disabled) btn.disabled = true;

    if (activeVal === val) {
      const cls = colorFn ? colorFn(val) : null;
      btn.classList.add(cls || 'active');
    }

    if (!disabled && onToggle) {
      btn.addEventListener('click', () => onToggle(val));
    }
    group.appendChild(btn);
  });
  return group;
}

// Multi-select toggle group
function makeToggleGroupMulti(values, activeVals, onToggle) {
  const group = document.createElement('div');
  group.className = 'toggle-group';
  values.forEach(val => {
    const btn = document.createElement('button');
    btn.className = 'toggle-btn';
    btn.textContent = val;
    if (CODE_TOOLTIPS[val]) btn.title = CODE_TOOLTIPS[val];
    const isActive = activeVals.includes(val);
    if (isActive) btn.classList.add('active');
    btn.addEventListener('click', () => onToggle(val, isActive));
    group.appendChild(btn);
  });
  return group;
}

// ── Summary Tab ────────────────────────────────────────────────────────────
function refreshSummary() {
  const container = document.getElementById('summary-content');
  const teeth = State.getTeethData();
  const charted = teeth.filter(t => State.getToothData(t.id));

  document.getElementById('summary-title').textContent =
    `Dental Chart Summary — ${State.current.patientName || 'Unnamed patient'} (${State.current.species === 'dog' ? 'Dog' : 'Cat'})`;

  if (charted.length === 0) {
    container.innerHTML = '<p class="empty-msg">No findings recorded yet.</p>';
    return;
  }

  container.innerHTML = '';
  charted.forEach(toothDef => {
    const data = State.getToothData(toothDef.id);
    const tags = buildFindingTags(data);
    if (tags.length === 0) return;

    const color = getToothColor(data);
    const colorClass = colorNameFromHex(color);

    const item = document.createElement('div');
    item.className = `summary-tooth ${colorClass}`;

    const hdr = document.createElement('div');
    hdr.className = 'summary-tooth-header';
    hdr.textContent = `${toothDef.id} — ${toothDef.name}`;
    item.appendChild(hdr);

    const tagRow = document.createElement('div');
    tagRow.className = 'summary-tooth-findings';
    tags.forEach(tag => {
      const span = document.createElement('span');
      span.className = 'finding-tag';
      span.textContent = tag;
      tagRow.appendChild(span);
    });
    item.appendChild(tagRow);
    container.appendChild(item);
  });
}

function buildFindingTags(data) {
  if (!data) return [];
  const tags = [];
  const f = data.findings;
  const p = data.procedures;

  if (f.missing) tags.push('Missing');
  if (f.periodontal.stage) {
    let pd = f.periodontal.stage;
    const depths = Object.values(f.periodontal.probingDepths).filter(v => v != null);
    if (depths.length) pd += ` (${depths.join('/')})`;
    tags.push(pd);
  }
  if (f.toothResorption.stage) {
    tags.push(f.toothResorption.type ? `${f.toothResorption.stage} ${f.toothResorption.type}` : f.toothResorption.stage);
  }
  if (f.fracture) tags.push(f.fracture);
  if (f.furcation && f.furcation !== 'F0') tags.push(f.furcation);
  if (f.mobility && f.mobility !== 'M0') tags.push(f.mobility);
  if (p.extraction) tags.push(`Ext (${p.extraction})`);
  if (p.periodontal.length) tags.push(...p.periodontal);
  return tags;
}

function colorNameFromHex(hex) {
  const map = {
    [COLORS.mild]: 'color-mild',
    [COLORS.warning]: 'color-warning',
    [COLORS.critical]: 'color-critical',
    [COLORS.extracted]: 'color-extracted',
  };
  return map[hex] || '';
}

// ── Keyboard Shortcuts ─────────────────────────────────────────────────────
let keyBuffer = '';
let keyBufferTimer = null;

function handleKeyDown(e) {
  // Don't fire shortcuts when typing in an input
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  const sel = [...State.selectedTeeth];
  const hasSelection = sel.length > 0;

  // Global shortcuts
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    if (State.undo()) {
      applyAllColors();
      if (sel.length === 1) renderSingleToothPanel(sel[0]);
      refreshSummary();
      showToast('Undo');
    }
    return;
  }

  if (e.key === '?') {
    document.getElementById('shortcut-overlay').classList.toggle('hidden');
    return;
  }

  if (e.key === 'Escape') {
    // Close popups first, then deselect
    const fracPop = document.getElementById('fracture-popup');
    if (!fracPop.classList.contains('hidden')) { closeFracturePopup(); return; }
    const overlay = document.getElementById('shortcut-overlay');
    if (!overlay.classList.contains('hidden')) { overlay.classList.add('hidden'); return; }
    clearSelection();
    return;
  }

  // Tab navigation between teeth
  if (e.key === 'Tab') {
    e.preventDefault();
    navigateTooth(e.shiftKey ? -1 : 1);
    return;
  }

  // Arrow key navigation
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
    e.preventDefault();
    navigateArrow(e.key);
    return;
  }

  if (!hasSelection) return;

  // Tooth-specific shortcuts
  const key = e.key.toUpperCase();

  // PD staging: 0–4
  if (/^[0-4]$/.test(e.key) && !e.shiftKey && !e.ctrlKey) {
    const stage = 'PD' + e.key;
    sel.forEach(id => {
      State.updateTooth(id, t => { t.findings.periodontal.stage = t.findings.periodontal.stage === stage ? null : stage; });
      updateToothVisual(id);
    });
    if (sel.length === 1) renderSingleToothPanel(sel[0]);
    refreshSummary();
    return;
  }

  // TR staging: T then 1–5
  if (key === 'T') {
    clearTimeout(keyBufferTimer);
    keyBuffer = 'T';
    keyBufferTimer = setTimeout(() => { keyBuffer = ''; }, 800);
    return;
  }
  if (keyBuffer === 'T' && /^[1-5]$/.test(e.key)) {
    keyBuffer = '';
    clearTimeout(keyBufferTimer);
    const stage = 'TR' + e.key;
    sel.forEach(id => {
      State.updateTooth(id, t => { t.findings.toothResorption.stage = t.findings.toothResorption.stage === stage ? null : stage; });
      updateToothVisual(id);
    });
    if (sel.length === 1) renderSingleToothPanel(sel[0]);
    refreshSummary();
    showToast(stage);
    return;
  }

  // Fracture popup
  if (key === 'X' && !e.ctrlKey) {
    openFracturePopup();
    return;
  }

  // Extraction
  if (key === 'E') {
    const val = e.shiftKey ? 'surgical' : 'simple';
    sel.forEach(id => {
      State.updateTooth(id, t => { t.procedures.extraction = t.procedures.extraction === val ? null : val; });
      updateToothVisual(id);
    });
    if (sel.length === 1) renderSingleToothPanel(sel[0]);
    refreshSummary();
    return;
  }

  // Perio procedures
  const perioCodes = {
    'S': 'PRO',
    'R': e.shiftKey ? 'RP/O' : 'RP/C',
    'G': 'GC',
  };
  if (perioCodes[key]) {
    const code = perioCodes[key];
    sel.forEach(id => {
      State.updateTooth(id, t => {
        if (t.procedures.periodontal.includes(code)) {
          t.procedures.periodontal = t.procedures.periodontal.filter(v => v !== code);
        } else {
          t.procedures.periodontal.push(code);
        }
      });
      updateToothVisual(id);
    });
    if (sel.length === 1) renderSingleToothPanel(sel[0]);
    refreshSummary();
    return;
  }

  // Missing
  if (key === 'M') {
    sel.forEach(id => {
      State.updateTooth(id, t => { t.findings.missing = !t.findings.missing; });
      updateToothVisual(id);
    });
    if (sel.length === 1) renderSingleToothPanel(sel[0]);
    refreshSummary();
    return;
  }

  // Delete/Backspace: clear findings
  if (e.key === 'Delete' || e.key === 'Backspace') {
    sel.forEach(id => State.clearTooth(id));
    applyAllColors();
    if (sel.length === 1) renderSingleToothPanel(sel[0]);
    refreshSummary();
    return;
  }
}

function navigateTooth(dir) {
  const teeth = State.getTeethData();
  const sel = [...State.selectedTeeth];
  if (sel.length === 0) {
    State.selectedTeeth.add(teeth[0].id);
  } else {
    const currentIdx = teeth.findIndex(t => t.id === sel[0]);
    const nextIdx = (currentIdx + dir + teeth.length) % teeth.length;
    State.selectedTeeth.clear();
    State.selectedTeeth.add(teeth[nextIdx].id);
  }
  applyAllColors();
  openDrawer();
}

function navigateArrow(key) {
  const sel = [...State.selectedTeeth];
  if (sel.length !== 1) return;
  const current = State.getTeethData().find(t => t.id === sel[0]);
  if (!current) return;

  const teeth = State.getTeethData();
  let best = null;
  let bestDist = Infinity;

  teeth.forEach(t => {
    if (t.id === current.id) return;
    const dx = t.svgX - current.svgX;
    const dy = t.svgY - current.svgY;

    const isInDir = (
      (key === 'ArrowLeft'  && dx < 0 && Math.abs(dx) > Math.abs(dy)) ||
      (key === 'ArrowRight' && dx > 0 && Math.abs(dx) > Math.abs(dy)) ||
      (key === 'ArrowUp'    && dy < 0 && Math.abs(dy) > Math.abs(dx)) ||
      (key === 'ArrowDown'  && dy > 0 && Math.abs(dy) > Math.abs(dx))
    );

    if (isInDir) {
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < bestDist) { bestDist = dist; best = t; }
    }
  });

  if (best) {
    State.selectedTeeth.clear();
    State.selectedTeeth.add(best.id);
    applyAllColors();
    openDrawer();
  }
}

// ── Fracture Popup ─────────────────────────────────────────────────────────
function openFracturePopup() {
  const sel = [...State.selectedTeeth];
  if (!sel.length) return;
  document.getElementById('fracture-popup').classList.remove('hidden');
}

function closeFracturePopup() {
  document.getElementById('fracture-popup').classList.add('hidden');
}

function applyFracture(val) {
  const sel = [...State.selectedTeeth];
  sel.forEach(id => {
    State.updateTooth(id, t => { t.findings.fracture = t.findings.fracture === val ? null : val; });
    updateToothVisual(id);
  });
  if (sel.length === 1) renderSingleToothPanel(sel[0]);
  refreshSummary();
  closeFracturePopup();
  showToast(val);
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.add('hidden'); }, 1800);
}

// ── Chart Text Generator ───────────────────────────────────────────────────
function generateChartText() {
  const teeth = State.getTeethData();
  const lines = [];
  const species = State.current.species === 'dog' ? 'Dog' : 'Cat';
  const patient = State.current.patientName || 'Unnamed';
  const date = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });

  lines.push(`DENTAL CHART — ${species} — ${patient} — ${date}`);
  lines.push('');

  const findingLines = [];
  const procedureMap = {}; // procedure → [tooth ids]

  teeth.forEach(toothDef => {
    const data = State.getToothData(toothDef.id);
    if (!data) return;

    const f = data.findings;
    const p = data.procedures;
    const parts = [];

    if (f.missing) { parts.push('Missing'); }
    if (f.periodontal?.stage && f.periodontal.stage !== 'PD0') {
      const depths = [f.periodontal.probingDepths?.mesioBuccal, f.periodontal.probingDepths?.buccal, f.periodontal.probingDepths?.distoBuccal]
        .filter(v => v != null);
      parts.push(depths.length ? `${f.periodontal.stage} (${depths.join('/')})` : f.periodontal.stage);
    }
    if (f.toothResorption?.stage) {
      parts.push(f.toothResorption.type ? `${f.toothResorption.stage} ${f.toothResorption.type}` : f.toothResorption.stage);
    }
    if (f.fracture) parts.push(f.fracture);
    if (f.furcation && f.furcation !== 'F0') parts.push(f.furcation);
    if (f.mobility && f.mobility !== 'M0') parts.push(f.mobility);

    if (parts.length) {
      findingLines.push(`  ${toothDef.id} (${toothDef.type}): ${parts.join(', ')}`);
    }

    // Group procedures
    if (p.extraction) {
      const key = `Extraction/${p.extraction}`;
      (procedureMap[key] = procedureMap[key] || []).push(toothDef.id);
    }
    p.periodontal?.forEach(proc => {
      (procedureMap[proc] = procedureMap[proc] || []).push(toothDef.id);
    });
  });

  if (findingLines.length) {
    lines.push('FINDINGS:');
    lines.push(...findingLines);
    lines.push('');
  }

  if (Object.keys(procedureMap).length) {
    lines.push('PROCEDURES:');
    Object.entries(procedureMap).forEach(([proc, ids]) => {
      lines.push(`  ${proc}: ${ids.join(', ')}`);
    });
    lines.push('');
  }

  if (findingLines.length === 0 && Object.keys(procedureMap).length === 0) {
    lines.push('No findings or procedures recorded.');
  }

  return lines.join('\n').trim();
}

// ── Settings / Ezyvet ──────────────────────────────────────────────────────
async function renderSettingsTab() {
  const species = State.current.species || 'dog';
  const allMaps = await new Promise(resolve =>
    chrome.storage.local.get(['ezyvetToothMap'], res => resolve(res.ezyvetToothMap || null))
  );
  // Support both migrated { dog: {...}, cat: {...} } and legacy flat format
  const speciesMap = allMaps
    ? ((allMaps.dog || allMaps.cat) ? (allMaps[species] || null) : (species === 'dog' ? allMaps : null))
    : null;
  const mapCount = speciesMap ? Object.keys(speciesMap).length : 0;
  const isMapped = mapCount > 0;

  const setupCard = document.getElementById('setup-card');
  const pushSection = document.getElementById('push-section');

  if (isMapped) {
    // Species is mapped — show push UI
    setupCard.style.display = 'none';
    pushSection.style.display = 'block';
    document.getElementById('mapping-status-text').textContent = `${mapCount} ${species} teeth mapped`;
    document.getElementById('chart-text-preview').textContent = buildPushPreview();
  } else {
    // Species not mapped — show setup card
    const speciesLabel = species === 'dog' ? 'Dog' : 'Cat';
    setupCard.style.display = 'flex';
    pushSection.style.display = 'none';
    document.getElementById('setup-card-title').textContent = `${speciesLabel} teeth not mapped yet`;
    document.getElementById('setup-card-status').textContent =
      `0 ${species} teeth mapped — mapping is required before pushing to EzyVet`;
  }
}

function buildPushPreview() {
  const teeth = State.getTeethData();
  const lines = [];
  teeth.forEach(toothDef => {
    const data = State.getToothData(toothDef.id);
    if (!data) return;
    const f = data.findings;
    const p = data.procedures;
    const checks = [];
    if (f.missing) checks.push('Missing');
    if (p.extraction) checks.push('Extracted');
    if (f.periodontal?.stage && f.periodontal.stage !== 'PD0') checks.push(f.periodontal.stage);
    if (f.furcation && f.furcation !== 'F0') checks.push(f.furcation);
    if (f.mobility && f.mobility !== 'M0') checks.push(f.mobility);
    if (f.fracture) checks.push(f.fracture);
    if (f.toothResorption?.stage) checks.push(f.toothResorption.stage);
    const pd = f.periodontal?.probingDepths;
    const depths = pd ? [pd.mesioBuccal, pd.buccal, pd.distoBuccal].filter(v => v != null) : [];
    const notes = [
      depths.length ? `Probe: ${depths.join('/')}mm` : '',
      f.toothResorption?.type || '',
      p.extraction ? `Ext: ${p.extraction}` : '',
      ...(p.periodontal || []),
    ].filter(Boolean).join(' | ');
    if (checks.length || notes) {
      lines.push(`Tooth ${toothDef.id}: ✓ ${checks.join(', ')}${notes ? `  [${notes}]` : ''}`);
    }
  });
  return lines.length ? lines.join('\n') : 'No findings to push yet.';
}

function handlePushComplete(result) {
  const statusEl = document.getElementById('push-status');
  if (result?.error) {
    statusEl.textContent = `✗ ${result.error}`;
    statusEl.className = 'push-status error';
  } else if (result?.errors?.length) {
    const skipped = result.errors.join('; ');
    statusEl.textContent = `⚠ Pushed ${result.pushed} teeth. ${result.errors.length} skipped: ${skipped}`;
    statusEl.className = 'push-status error';
  } else {
    statusEl.textContent = `✓ Pushed ${result?.pushed ?? 0} teeth to Ezyvet successfully`;
    statusEl.className = 'push-status success';
    renderSettingsTab();
  }
}

async function pushToEzyvet() {
  const statusEl = document.getElementById('push-status');
  statusEl.textContent = 'Pushing to Ezyvet… (do not click away)';
  statusEl.className = 'push-status';

  const species = State.current.species || 'dog';
  const allMaps = await new Promise(resolve =>
    chrome.storage.local.get(['ezyvetToothMap'], r => resolve(r.ezyvetToothMap || null))
  );
  const speciesMap = allMaps
    ? ((allMaps.dog || allMaps.cat) ? (allMaps[species] || null) : (species === 'dog' ? allMaps : null))
    : null;
  if (!speciesMap) {
    statusEl.textContent = `⚠ No ${species} map yet. Map teeth first using the setup above.`;
    statusEl.className = 'push-status error';
    return;
  }

  statusEl.textContent = 'Pushing…';

  // Clear only the stale push result — preserve the manually built tooth map
  chrome.storage.local.remove(['pushResult']);

  // Storage-based result listener — reliable even if service worker relay is dormant
  function onStorageChange(changes, area) {
    if (area !== 'local' || !changes.pushResult) return;
    chrome.storage.onChanged.removeListener(onStorageChange);
    handlePushComplete(changes.pushResult.newValue?.result);
  }
  chrome.storage.onChanged.addListener(onStorageChange);

  // Send fire-and-forget — result also arrives via storage listener above
  chrome.runtime.sendMessage({
    action: 'toContent',
    payload: { action: 'fillDentalChart', chartData: State.current }
  }, (response) => {
    if (chrome.runtime.lastError) {
      chrome.storage.onChanged.removeListener(onStorageChange);
      statusEl.textContent = `✗ ${chrome.runtime.lastError.message}`;
      statusEl.className = 'push-status error';
    } else if (response?.error) {
      chrome.storage.onChanged.removeListener(onStorageChange);
      statusEl.textContent = `✗ ${response.error}`;
      statusEl.className = 'push-status error';
    }
    // response.started === true → wait for storage listener or pushComplete message
  });
}

// ── Export / Import ────────────────────────────────────────────────────────
function exportJSON() {
  const data = JSON.stringify(State.current, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const name = State.current.patientName || 'dental-chart';
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${name}-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.species || !data.teeth) throw new Error('Invalid chart file');
      State.current = data;
      State.scheduleSave();
      State.selectedTeeth.clear();
      updateSpeciesButtons();
      document.getElementById('patient-name').value = data.patientName || '';
      renderChart();
      refreshSummary();
      showToast('Chart imported', 'success');
    } catch (err) {
      showToast('Import failed: invalid file', 'error');
    }
  };
  reader.readAsText(file);
}

// ── Report Generation ─────────────────────────────────────────────────────
function buildReportColumns(data) {
  const findings = [];
  const procedures = [];
  if (!data) return { findings, procedures };
  const f = data.findings;
  const p = data.procedures;

  if (f.missing) findings.push('Missing');
  if (f.periodontal.stage) {
    let pd = f.periodontal.stage;
    const depths = Object.values(f.periodontal.probingDepths).filter(v => v != null);
    if (depths.length) pd += ` (${depths.join('/')})`;
    findings.push(pd);
  }
  if (f.toothResorption.stage) {
    findings.push(f.toothResorption.type ? `${f.toothResorption.stage} ${f.toothResorption.type}` : f.toothResorption.stage);
  }
  if (f.fracture) findings.push(f.fracture);
  if (f.furcation && f.furcation !== 'F0') findings.push(f.furcation);
  if (f.mobility && f.mobility !== 'M0') findings.push(f.mobility);

  if (p.extraction) procedures.push(`Extraction (${p.extraction})`);
  if (p.periodontal.length) procedures.push(...p.periodontal);

  return { findings, procedures };
}

function scanPatientFromEzyvet(_event, silent = false) {
  chrome.runtime.sendMessage(
    { action: 'toContent', payload: { action: 'scrapePatientInfo' } },
    (resp) => {
      if (resp?.patientName) {
        const nameInput = document.getElementById('patient-name');
        nameInput.value = resp.patientName;
        State.setPatientName(resp.patientName);

        // Auto-switch species if detected and chart is empty
        if (resp.species && resp.species !== State.current.species && Object.keys(State.current.teeth).length === 0) {
          State.setSpecies(resp.species);
          updateSpeciesButtons();
          renderChart();
        }

        if (!silent) showToast(`Patient: ${resp.patientName}`);
      } else if (!silent) {
        showToast('Patient not found — is EzyVet open?', 'error');
      }
    }
  );
}

// Cache the dental chart image so it survives EzyVet DOM changes (e.g. after push)
let cachedChartImg = null;

function grabDentalChartHtml() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      { action: 'toContent', payload: { action: 'grabDentalChartHtml' } },
      (resp) => {
        if (resp?.html) {
          cachedChartImg = resp.html;
          return resolve(resp.html);
        }
        // Retry once — the content script may need to be injected first by background.js,
        // after which it will poll for up to 8s for the SVG to appear.
        // Allow 2s for injection before retrying.
        setTimeout(() => {
          chrome.runtime.sendMessage(
            { action: 'toContent', payload: { action: 'grabDentalChartHtml' } },
            (resp2) => {
              if (resp2?.html) cachedChartImg = resp2.html;
              resolve(resp2?.html || cachedChartImg);
            }
          );
        }, 2000);
      }
    );
  });
}

// Pre-cache the chart image on load
function preCacheChartImage() {
  chrome.runtime.sendMessage(
    { action: 'toContent', payload: { action: 'grabDentalChartHtml' } },
    (resp) => { if (resp?.html) cachedChartImg = resp.html; }
  );
}

async function generateReport() {
  const teeth = State.getTeethData();
  const chartedTeeth = [];
  for (const toothDef of teeth) {
    const data = State.getToothData(toothDef.id);
    if (!data) continue;
    const { findings, procedures } = buildReportColumns(data);
    if (findings.length === 0 && procedures.length === 0) continue;
    const color = getToothColor(data);
    chartedTeeth.push({ id: toothDef.id, name: toothDef.name, color, findings, procedures });
  }

  if (chartedTeeth.length === 0) {
    showToast('No findings to report', 'error');
    return;
  }

  const patient = State.current.patientName || 'Unnamed Patient';
  const species = State.current.species === 'cat' ? 'Cat' : 'Dog';
  const dateCreated = State.current.dateCreated
    ? new Date(State.current.dateCreated).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  const generatedAt = new Date().toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Grab the EzyVet dental chart image (falls back to cached version)
  let diagramImg = null;
  try { diagramImg = await grabDentalChartHtml(); } catch (_) {}
  if (!diagramImg && cachedChartImg) diagramImg = cachedChartImg;

  // Build table rows
  const rows = chartedTeeth.map(t => `
    <tr>
      <td><span class="color-dot" style="background:${t.color}"></span>${t.id}</td>
      <td>${t.name}</td>
      <td>${t.findings.join(', ') || '—'}</td>
      <td>${t.procedures.join(', ') || '—'}</td>
    </tr>`).join('');

  const html = buildReportHtml({ patient, species, dateCreated, generatedAt, diagramImg, rows });

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({ url });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function buildReportHtml({ patient, species, dateCreated, generatedAt, diagramImg, rows,
                           patientId, dob, age, weight, sex, breed, ownerName,
                           clinicName, veterinarian }) {
  const diagramSection = diagramImg
    ? `<div class="diagram-section">${diagramImg}</div>`
    : `<div class="diagram-section"><div class="no-diagram">EzyVet dental diagram not available — ensure the dental chart is visible in the active tab before generating.</div></div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Dental Report — ${patient}</title>
<style>
  @page { size: A4 portrait; margin: 10mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 10pt; color: #1e293b; padding: 12mm; }
  .report-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #334155; padding-bottom: 6px; margin-bottom: 8px; }
  .report-header h1 { font-size: 14pt; font-weight: 700; margin-bottom: 4px; }
  .report-header .meta { font-size: 9pt; color: #64748b; text-align: right; line-height: 1.5; }
  .header-left { flex: 1; }
  .header-right { text-align: right; font-size: 9pt; color: #64748b; line-height: 1.6; white-space: nowrap; }
  .clinic-name { font-weight: 600; font-size: 10pt; color: #334155; }
  .patient-details { font-size: 9pt; margin-top: 2px; }
  .patient-details td { padding: 1px 6px 1px 0; border: none; background: none !important; }
  .patient-details .label { font-weight: 600; color: #475569; white-space: nowrap; }
  .diagram-section { text-align: center; margin: 8px 0; overflow: hidden; max-height: 300px; }
  .diagram-section img { max-width: 100%; max-height: 280px; object-fit: contain; }
  .no-diagram { font-size: 9pt; color: #94a3b8; font-style: italic; padding: 24px; text-align: center; border: 1px dashed #cbd5e1; border-radius: 4px; }
  .section-title { font-size: 11pt; font-weight: 600; margin: 8px 0 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th { background: #f1f5f9; text-align: left; padding: 4px 6px; border-bottom: 2px solid #cbd5e1; font-weight: 600; }
  td { padding: 3px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) { background: #f8fafc; }
  .color-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .footer { margin-top: 10px; font-size: 7pt; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 4px; }
  @media print {
    body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="report-header">
    <div class="header-left">
      <h1>${species} Dental Chart — ${patient}</h1>
      <table class="patient-details">
        <tr><td class="label">Patient:</td><td>${patient}${sex ? ' (' + sex + ')' : ''}</td></tr>
        ${patientId ? '<tr><td class="label">Patient ID:</td><td>' + patientId + '</td></tr>' : ''}
        <tr><td class="label">Species / Breed:</td><td>${species}${breed ? ' — ' + breed : ''}</td></tr>
        ${dob ? '<tr><td class="label">Date of Birth:</td><td>' + dob + '</td></tr>' : ''}
        ${age ? '<tr><td class="label">Age:</td><td>' + age + '</td></tr>' : ''}
        ${weight ? '<tr><td class="label">Weight:</td><td>' + weight + '</td></tr>' : ''}
        ${ownerName ? '<tr><td class="label">Owner:</td><td>' + ownerName + '</td></tr>' : ''}
      </table>
    </div>
    <div class="header-right">
      ${clinicName ? '<div class="clinic-name">' + clinicName + '</div>' : ''}
      ${veterinarian ? '<div>' + veterinarian + '</div>' : ''}
      <div>Chart date: ${dateCreated}</div>
    </div>
  </div>
  ${diagramSection}
  <div class="section-title">Findings &amp; Procedures</div>
  <table>
    <thead><tr><th>Tooth</th><th>Name</th><th>Findings</th><th>Procedures</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">Generated by DentaVet &middot; ${generatedAt}</div>
</body>
</html>`;
}

async function generateEzyvetReport() {
  showToast('Reading EzyVet dental data…');

  // Scrape findings from the EzyVet page (with retry)
  let scrapeResult;
  try {
    scrapeResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'toContent', payload: { action: 'scrapeEzyvetDental' } },
        (resp) => {
          if (resp?.teeth || resp?.patientInfo) return resolve(resp);
          // Retry once after a short delay
          setTimeout(() => {
            chrome.runtime.sendMessage(
              { action: 'toContent', payload: { action: 'scrapeEzyvetDental' } },
              (resp2) => resolve(resp2 || { error: 'No response from EzyVet tab' })
            );
          }, 1000);
        }
      );
    });
  } catch (_) {
    showToast('Could not reach EzyVet tab', 'error');
    return;
  }

  if (scrapeResult.error) {
    showToast(scrapeResult.error, 'error');
    return;
  }

  if (!scrapeResult.teeth || scrapeResult.teeth.length === 0) {
    showToast('No dental findings found on the EzyVet page', 'error');
    return;
  }

  // Determine species and look up tooth names
  const species = scrapeResult.patientInfo?.species || State.current.species || 'dog';
  const speciesLabel = species === 'cat' ? 'Cat' : 'Dog';
  const teethDefs = species === 'cat' ? CATS : DOGS;
  const toothNameMap = {};
  for (const t of teethDefs) toothNameMap[t.id] = t.name;

  const patient = scrapeResult.patientInfo?.patientName || 'Unknown Patient';
  // Use the date from the first tooth entry if available
  const firstDate = scrapeResult.teeth[0]?.date || '';
  const dateCreated = firstDate.split('\n')[0] || new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  const generatedAt = new Date().toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Grab the EzyVet dental chart image (falls back to cached version)
  let diagramImg = null;
  try { diagramImg = await grabDentalChartHtml(); } catch (_) {}
  if (!diagramImg && cachedChartImg) diagramImg = cachedChartImg;

  // Build table rows sorted by tooth ID
  const sorted = [...scrapeResult.teeth].sort((a, b) => a.toothId - b.toothId);
  const rows = sorted.map(t => `
    <tr>
      <td>${t.toothId}</td>
      <td>${toothNameMap[t.toothId] || '—'}</td>
      <td>${t.findings.join(', ') || '—'}</td>
      <td>${t.procedures.join(', ') || '—'}</td>
    </tr>`).join('');

  const pi = scrapeResult.patientInfo || {};
  const html = buildReportHtml({
    patient, species: speciesLabel, dateCreated, generatedAt, diagramImg, rows,
    patientId: pi.patientId, dob: pi.dob, age: pi.age, weight: pi.weight,
    sex: pi.sex, breed: pi.breed, ownerName: pi.ownerName,
    clinicName: pi.clinicName, veterinarian: pi.veterinarian,
  });

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({ url });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ── Tab System ─────────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tabId}`));
  if (tabId === 'summary') refreshSummary();
  if (tabId === 'settings') { renderSettingsTab(); renderLicenceSettings(); }
}

// ── Species toggle ─────────────────────────────────────────────────────────
function updateSpeciesButtons() {
  document.querySelectorAll('.species-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.species === State.current.species);
  });
}

// ── Listen for messages from content script ────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'contentMessage') {
    const payload = message.payload;

    if (payload.action === 'pushProgress') {
      const statusEl = document.getElementById('push-status');
      statusEl.textContent = `Pushing tooth ${payload.toothId}… (${payload.current}/${payload.total})`;
      statusEl.className = 'push-status';
    }

    if (payload.action === 'pushComplete') {
      handlePushComplete(payload.result);
    }

    if (payload.action === 'discoverProgress') {
      const statusEl = document.getElementById('discover-status');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#94A3B8';
        statusEl.textContent = `Discovering… polygon ${payload.current}/${payload.total} — ${payload.found} teeth found so far`;
      }
    }

    if (payload.action === 'discoverComplete') {
      const result = payload.result;
      const statusEl = document.getElementById('discover-status');
      if (statusEl) {
        if (result?.ok) {
          statusEl.textContent = `✓ Discovered ${result.count} teeth — map is ready`;
          statusEl.style.color = '#22C55E';
          renderSettingsTab();
        } else {
          statusEl.textContent = `✗ ${result?.error || 'Discovery failed'}`;
          statusEl.style.color = '#E74C3C';
        }
      }
    }

    if (payload.action === 'toothPatternSaved') {
      renderSettingsTab();
      showToast('Tooth mapped — ready to push charts!', 'success');
    }

    if (payload.action === 'toothMapped') {
      renderSettingsTab();
    }

    if (payload.action === 'ezyvetDetected') {
      document.getElementById('ezyvet-status-text').textContent = 'Ezyvet detected on active tab';
      document.querySelector('#ezyvet-status .status-dot').className = 'status-dot status-ok';
    }
  }
});

// ── Licence Gate UI ──────────────────────────────────────────────────────

function showLicenceGate(state) {
  const gate = document.getElementById('licence-gate');
  gate.classList.remove('hidden');

  const errorEl = document.getElementById('licence-error');
  const input = document.getElementById('licence-key-input');

  // Show context-specific message
  if (state.status === 'expired') {
    errorEl.textContent = 'Your 14-day trial has ended. Please activate a licence to continue.';
    errorEl.style.color = '#F1C40F';
  } else {
    errorEl.textContent = '';
  }

  // Activate button
  document.getElementById('btn-activate-licence').onclick = async () => {
    const key = input.value.trim();
    if (!key) { errorEl.textContent = 'Please enter a licence key.'; errorEl.style.color = ''; return; }

    errorEl.textContent = 'Activating...';
    errorEl.style.color = 'var(--text-muted)';
    const result = await activateLicence(key);
    if (result.ok) {
      gate.classList.add('hidden');
      hideTrialBanner();
      renderLicenceSettings();
      showToast('Licence activated!', 'success');
    } else {
      errorEl.textContent = result.error;
      errorEl.style.color = '';
    }
  };

  // Enter key to activate
  input.onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('btn-activate-licence').click();
  };

  // Trial button
  const trialBtn = document.getElementById('btn-start-trial');
  if (state.status === 'expired') {
    trialBtn.style.display = 'none';
  } else if (state.status === 'trial') {
    trialBtn.style.display = '';
    trialBtn.textContent = `Continue with Trial (${state.daysRemaining} day${state.daysRemaining !== 1 ? 's' : ''} left)`;
    trialBtn.onclick = () => {
      gate.classList.add('hidden');
    };
  } else {
    trialBtn.style.display = '';
    trialBtn.textContent = 'Start 14-Day Free Trial';
    trialBtn.onclick = async () => {
      await initTrial();
      gate.classList.add('hidden');
      const updated = await getLicenceState();
      showTrialBanner(updated);
      renderLicenceSettings();
    };
  }
}

function showTrialBanner(state) {
  const banner = document.getElementById('trial-banner');
  const text = document.getElementById('trial-banner-text');
  banner.classList.remove('hidden');
  text.textContent = `Trial: ${state.daysRemaining} day${state.daysRemaining !== 1 ? 's' : ''} remaining`;

  document.getElementById('trial-banner-activate').onclick = () => {
    showLicenceGate(state);
  };
}

function hideTrialBanner() {
  document.getElementById('trial-banner').classList.add('hidden');
}

async function renderLicenceSettings() {
  const state = await getLicenceState();
  const dot = document.getElementById('licence-status-dot');
  const text = document.getElementById('licence-status-text');
  const actions = document.getElementById('licence-settings-actions');

  if (state.status === 'active') {
    dot.className = 'status-dot status-ok';
    text.textContent = 'Licence active';
    const masked = state.licenceKey
      ? state.licenceKey.slice(0, 8) + '...' + state.licenceKey.slice(-4)
      : '';
    actions.innerHTML = `
      <div class="licence-key-display">${masked}</div>
      <div class="licence-meta">Activated: ${new Date(state.activatedAt).toLocaleDateString()}</div>
      <button id="btn-deactivate-licence" class="action-btn danger">Deactivate This Device</button>
    `;
    document.getElementById('btn-deactivate-licence').addEventListener('click', async () => {
      if (!confirm('Deactivate DentaVet on this device? You can re-activate on another device.')) return;
      const result = await deactivateLicence();
      if (result.ok) {
        showToast('Licence deactivated', 'success');
        const fresh = await getLicenceState();
        showLicenceGate(fresh);
        renderLicenceSettings();
      } else {
        showToast(result.error, 'error');
      }
    });

  } else if (state.status === 'trial') {
    dot.className = 'status-dot';
    dot.style.background = '#F1C40F';
    text.textContent = `Trial — ${state.daysRemaining} day${state.daysRemaining !== 1 ? 's' : ''} remaining`;
    actions.innerHTML = `
      <div class="licence-input-group">
        <input id="settings-licence-key" type="text" placeholder="Enter licence key" class="licence-input" autocomplete="off" spellcheck="false">
      </div>
      <button id="btn-settings-activate" class="action-btn primary">Activate Licence</button>
      <a href="https://lemonsqueezy.com" target="_blank" class="licence-buy-link">Purchase a licence key</a>
    `;
    document.getElementById('btn-settings-activate').addEventListener('click', async () => {
      const key = document.getElementById('settings-licence-key').value.trim();
      if (!key) { showToast('Enter a licence key', 'error'); return; }
      const result = await activateLicence(key);
      if (result.ok) {
        hideTrialBanner();
        showToast('Licence activated!', 'success');
        renderLicenceSettings();
      } else {
        showToast(result.error, 'error');
      }
    });

  } else if (state.status === 'expired') {
    dot.className = 'status-dot status-error';
    text.textContent = 'Trial expired';
    actions.innerHTML = `
      <div class="licence-input-group">
        <input id="settings-licence-key" type="text" placeholder="Enter licence key" class="licence-input" autocomplete="off" spellcheck="false">
      </div>
      <button id="btn-settings-activate" class="action-btn primary">Activate Licence</button>
      <a href="https://lemonsqueezy.com" target="_blank" class="licence-buy-link">Purchase a licence key</a>
    `;
    document.getElementById('btn-settings-activate').addEventListener('click', async () => {
      const key = document.getElementById('settings-licence-key').value.trim();
      if (!key) { showToast('Enter a licence key', 'error'); return; }
      const result = await activateLicence(key);
      if (result.ok) {
        document.getElementById('licence-gate').classList.add('hidden');
        hideTrialBanner();
        showToast('Licence activated!', 'success');
        renderLicenceSettings();
      } else {
        showToast(result.error, 'error');
      }
    });

  } else {
    dot.className = 'status-dot status-unknown';
    text.textContent = 'Not activated';
    actions.innerHTML = `
      <a href="https://lemonsqueezy.com" target="_blank" class="licence-buy-link">Purchase a licence key</a>
    `;
  }
}

// ── Landing Page ─────────────────────────────────────────────────────────

function showLandingPage() {
  document.getElementById('landing-page').classList.remove('hidden');
  document.querySelector('.header-controls').style.display = 'none';
  document.querySelector('.tab-nav').style.display = 'none';
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
}

function hideLandingPage() {
  document.getElementById('landing-page').classList.add('hidden');
  document.querySelector('.header-controls').style.display = '';
  document.querySelector('.tab-nav').style.display = '';
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = '');
  // Re-trigger active tab display
  switchTab('chart');
}

function startChartFromLanding(species) {
  const hasData = Object.keys(State.current.teeth).length > 0;
  if (hasData && State.current.species !== species) {
    if (!confirm('Switching species will clear the current chart. Continue?')) return;
  }
  State.setSpecies(species);
  updateSpeciesButtons();
  renderChart();
  refreshSummary();
  closeDrawer();
  renderSettingsTab();
  hideLandingPage();
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  await State.load();

  // ── Licence gate ──
  if (!DEV_MODE) {
    const licenceState = await getLicenceState();
    if (licenceState.status === 'inactive' || licenceState.status === 'expired') {
      showLicenceGate(licenceState);
    }
    if (licenceState.status === 'trial') {
      showTrialBanner(licenceState);
    }
    if (licenceState.status === 'active') {
      validateLicence().catch(() => {});
    }
  }

  // Render chart + wire SVG events once
  renderChart();
  bindSVGEvents();

  // Restore UI state
  document.getElementById('patient-name').value = State.current.patientName || '';
  updateSpeciesButtons();

  // ── Landing page ──
  // Show landing if no chart data exists yet
  const hasExistingChart = Object.keys(State.current.teeth).length > 0 || State.current.patientName;
  if (!hasExistingChart) {
    showLandingPage();
  } else {
    document.getElementById('landing-page').classList.add('hidden');
  }

  // Landing page buttons
  document.getElementById('landing-dog').addEventListener('click', () => startChartFromLanding('dog'));
  document.getElementById('landing-cat').addEventListener('click', () => startChartFromLanding('cat'));
  document.getElementById('landing-scan').addEventListener('click', () => {
    hideLandingPage();
    scanPatientFromEzyvet();
  });

  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Species toggle
  document.querySelectorAll('.species-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.species === State.current.species) return;
      const hasData = Object.keys(State.current.teeth).length > 0;
      if (hasData && !confirm('Switching species will clear the current chart. Continue?')) return;
      State.setSpecies(btn.dataset.species);
      updateSpeciesButtons();
      renderChart();
      refreshSummary();
      closeDrawer();
      renderSettingsTab();
    });
  });

  // Patient name
  document.getElementById('patient-name').addEventListener('input', (e) => {
    State.setPatientName(e.target.value);
  });

  // Scan patient from EzyVet
  document.getElementById('btn-scan-patient').addEventListener('click', scanPatientFromEzyvet);

  // Auto-scan patient on load (if name field is empty and chart has data)
  if (!State.current.patientName && hasExistingChart) {
    scanPatientFromEzyvet(null, true);
  }

  // Pre-cache the EzyVet dental chart image for reports
  preCacheChartImage();

  // New chart — clears data and returns to landing page
  document.getElementById('btn-new-chart').addEventListener('click', () => {
    if (Object.keys(State.current.teeth).length > 0 && !confirm('Clear current chart and start a new one?')) return;
    State.clearAll();
    document.getElementById('patient-name').value = '';
    State.setPatientName('');
    applyAllColors();
    closeDrawer();
    refreshSummary();
    showLandingPage();
  });

  // Drawer close
  document.getElementById('drawer-close').addEventListener('click', () => {
    clearSelection();
  });

  // Shortcut help
  document.getElementById('btn-shortcut-help').addEventListener('click', () => {
    document.getElementById('shortcut-overlay').classList.remove('hidden');
  });
  document.getElementById('close-shortcut-overlay').addEventListener('click', () => {
    document.getElementById('shortcut-overlay').classList.add('hidden');
  });

  // Settings button
  document.getElementById('btn-settings').addEventListener('click', () => switchTab('settings'));

  // Fracture popup buttons
  document.querySelectorAll('.fracture-opt').forEach(btn => {
    btn.addEventListener('click', () => applyFracture(btn.dataset.val));
  });
  document.querySelector('.fracture-cancel').addEventListener('click', closeFracturePopup);

  // Fracture popup number keys (1–7)
  document.addEventListener('keydown', (e) => {
    const popup = document.getElementById('fracture-popup');
    if (!popup.classList.contains('hidden') && /^[1-7]$/.test(e.key)) {
      const btns = [...document.querySelectorAll('.fracture-opt')];
      const btn = btns[parseInt(e.key, 10) - 1];
      if (btn) applyFracture(btn.dataset.val);
    }
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', handleKeyDown);

  // Report / Export / Import
  document.getElementById('btn-ezyvet-report').addEventListener('click', generateEzyvetReport);
  document.getElementById('btn-export-json').addEventListener('click', exportJSON);
  document.getElementById('btn-import-json').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', (e) => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
    e.target.value = '';
  });

  // Ezyvet settings
  document.getElementById('btn-map-all-teeth').addEventListener('click', async () => {
    const species = State.current.species || 'dog';
    const { ezyvetToothMap: allMaps = {} } = await chrome.storage.local.get('ezyvetToothMap');
    // Extract only the slice for the current species
    const raw = (allMaps.dog || allMaps.cat)
      ? (allMaps[species] || {})
      : (species === 'dog' ? allMaps : {});
    // Detect corruption: dog-only teeth stored in the cat slot (from a previous bug)
    const DOG_ONLY = new Set([105,110,205,210,305,306,310,311,405,406,410,411]);
    const corrupted = species === 'cat' && Object.keys(raw).some(k => DOG_ONLY.has(parseInt(k)));
    if (corrupted) {
      const cleaned = { ...allMaps };
      delete cleaned.cat;
      chrome.storage.local.set({ ezyvetToothMap: cleaned });
    }
    const existingMap = corrupted ? {} : raw;
    chrome.runtime.sendMessage({
      action: 'toContent',
      payload: { action: 'startMultiToothInspector', species, existingMap }
    }, (response) => {
      if (chrome.runtime.lastError || response?.error) {
        showToast('Could not reach Ezyvet tab. Make sure Ezyvet is open.', 'error');
      } else {
        showToast('Inspector open — click a tooth number, then click its polygon in Ezyvet', 'success');
      }
    });
  });

  document.getElementById('btn-remap-teeth').addEventListener('click', async () => {
    const species = State.current.species || 'dog';
    if (!confirm(`Re-map all ${species} teeth? This will clear the existing ${species} map.`)) return;
    // Clear only the current species map
    const { ezyvetToothMap: allMaps = {} } = await chrome.storage.local.get('ezyvetToothMap');
    const cleaned = { ...allMaps };
    delete cleaned[species];
    await chrome.storage.local.set({ ezyvetToothMap: cleaned });
    renderSettingsTab();
  });

  document.getElementById('btn-push-ezyvet').addEventListener('click', pushToEzyvet);

  // Check if Ezyvet is active
  chrome.runtime.sendMessage(
    { action: 'toContent', payload: { action: 'ping' } },
    (response) => {
      if (!chrome.runtime.lastError && response?.pong) {
        document.getElementById('ezyvet-status-text').textContent = 'Ezyvet detected on active tab';
        document.querySelector('#ezyvet-status .status-dot').className = 'status-dot status-ok';
      }
    }
  );

  // Render licence status in settings
  renderLicenceSettings();
}

init();
