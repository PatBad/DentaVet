// Modified Triadan System — Cats (30 adult teeth)
// SVG viewBox: 0 0 900 480
// Same coordinate system as dogs.js
//
// Cat dental formula: I 3/3, C 1/1, PM 3/2, M 1/1 = 30 teeth
// Missing teeth vs dogs:
//   Upper: no 105 (P1), no 110 (M2), no 111 (not in dogs either)
//   Lower: no 305/405 (P1), no 306/406 (P2), no 310/311, no 410/411 (extra molars)
// The gaps in numbering are simply absent — e.g. 104 → 106 (skipping 105)

export const CATS = [
  // ── UPPER RIGHT (100s) ───────────────────────────────────────────────────
  { id: 101, quadrant: 'UR', jaw: 'upper', type: 'I1', name: 'Upper Right 1st Incisor',  roots: 1, size: 'incisor',   svgX: 430, svgY: 92  },
  { id: 102, quadrant: 'UR', jaw: 'upper', type: 'I2', name: 'Upper Right 2nd Incisor',  roots: 1, size: 'incisor',   svgX: 407, svgY: 86  },
  { id: 103, quadrant: 'UR', jaw: 'upper', type: 'I3', name: 'Upper Right 3rd Incisor',  roots: 1, size: 'incisor',   svgX: 382, svgY: 83  },
  { id: 104, quadrant: 'UR', jaw: 'upper', type: 'C',  name: 'Upper Right Canine',       roots: 1, size: 'canine',    svgX: 344, svgY: 102 },
  // 105 does not exist in cats
  { id: 106, quadrant: 'UR', jaw: 'upper', type: 'P2', name: 'Upper Right 2nd Premolar', roots: 1, size: 'premolar',  svgX: 293, svgY: 128 },
  { id: 107, quadrant: 'UR', jaw: 'upper', type: 'P3', name: 'Upper Right 3rd Premolar', roots: 2, size: 'premolar',  svgX: 253, svgY: 140 },
  { id: 108, quadrant: 'UR', jaw: 'upper', type: 'P4', name: 'Upper Right 4th Premolar (Carnassial)', roots: 3, size: 'carnassial', svgX: 206, svgY: 151 },
  { id: 109, quadrant: 'UR', jaw: 'upper', type: 'M1', name: 'Upper Right 1st Molar',   roots: 2, size: 'molar-sm',  svgX: 159, svgY: 158 },
  // 110, 111 do not exist in cats

  // ── UPPER LEFT (200s) ────────────────────────────────────────────────────
  { id: 201, quadrant: 'UL', jaw: 'upper', type: 'I1', name: 'Upper Left 1st Incisor',   roots: 1, size: 'incisor',   svgX: 470, svgY: 92  },
  { id: 202, quadrant: 'UL', jaw: 'upper', type: 'I2', name: 'Upper Left 2nd Incisor',   roots: 1, size: 'incisor',   svgX: 493, svgY: 86  },
  { id: 203, quadrant: 'UL', jaw: 'upper', type: 'I3', name: 'Upper Left 3rd Incisor',   roots: 1, size: 'incisor',   svgX: 518, svgY: 83  },
  { id: 204, quadrant: 'UL', jaw: 'upper', type: 'C',  name: 'Upper Left Canine',        roots: 1, size: 'canine',    svgX: 556, svgY: 102 },
  // 205 does not exist in cats
  { id: 206, quadrant: 'UL', jaw: 'upper', type: 'P2', name: 'Upper Left 2nd Premolar',  roots: 1, size: 'premolar',  svgX: 607, svgY: 128 },
  { id: 207, quadrant: 'UL', jaw: 'upper', type: 'P3', name: 'Upper Left 3rd Premolar',  roots: 2, size: 'premolar',  svgX: 647, svgY: 140 },
  { id: 208, quadrant: 'UL', jaw: 'upper', type: 'P4', name: 'Upper Left 4th Premolar (Carnassial)', roots: 3, size: 'carnassial', svgX: 694, svgY: 151 },
  { id: 209, quadrant: 'UL', jaw: 'upper', type: 'M1', name: 'Upper Left 1st Molar',    roots: 2, size: 'molar-sm',  svgX: 741, svgY: 158 },
  // 210, 211 do not exist in cats

  // ── LOWER LEFT (300s) ────────────────────────────────────────────────────
  { id: 301, quadrant: 'LL', jaw: 'lower', type: 'I1', name: 'Lower Left 1st Incisor',   roots: 1, size: 'incisor',   svgX: 470, svgY: 328 },
  { id: 302, quadrant: 'LL', jaw: 'lower', type: 'I2', name: 'Lower Left 2nd Incisor',   roots: 1, size: 'incisor',   svgX: 493, svgY: 334 },
  { id: 303, quadrant: 'LL', jaw: 'lower', type: 'I3', name: 'Lower Left 3rd Incisor',   roots: 1, size: 'incisor',   svgX: 518, svgY: 338 },
  { id: 304, quadrant: 'LL', jaw: 'lower', type: 'C',  name: 'Lower Left Canine',        roots: 1, size: 'canine',    svgX: 556, svgY: 316 },
  // 305, 306 do not exist in cats
  { id: 307, quadrant: 'LL', jaw: 'lower', type: 'P3', name: 'Lower Left 3rd Premolar',  roots: 2, size: 'premolar',  svgX: 616, svgY: 282 },
  { id: 308, quadrant: 'LL', jaw: 'lower', type: 'P4', name: 'Lower Left 4th Premolar (Carnassial)', roots: 2, size: 'carnassial', svgX: 661, svgY: 268 },
  { id: 309, quadrant: 'LL', jaw: 'lower', type: 'M1', name: 'Lower Left 1st Molar',    roots: 2, size: 'molar-sm',  svgX: 702, svgY: 260 },
  // 310, 311 do not exist in cats

  // ── LOWER RIGHT (400s) ───────────────────────────────────────────────────
  { id: 401, quadrant: 'LR', jaw: 'lower', type: 'I1', name: 'Lower Right 1st Incisor',  roots: 1, size: 'incisor',   svgX: 430, svgY: 328 },
  { id: 402, quadrant: 'LR', jaw: 'lower', type: 'I2', name: 'Lower Right 2nd Incisor',  roots: 1, size: 'incisor',   svgX: 407, svgY: 334 },
  { id: 403, quadrant: 'LR', jaw: 'lower', type: 'I3', name: 'Lower Right 3rd Incisor',  roots: 1, size: 'incisor',   svgX: 382, svgY: 338 },
  { id: 404, quadrant: 'LR', jaw: 'lower', type: 'C',  name: 'Lower Right Canine',       roots: 1, size: 'canine',    svgX: 344, svgY: 316 },
  // 405, 406 do not exist in cats
  { id: 407, quadrant: 'LR', jaw: 'lower', type: 'P3', name: 'Lower Right 3rd Premolar', roots: 2, size: 'premolar',  svgX: 284, svgY: 282 },
  { id: 408, quadrant: 'LR', jaw: 'lower', type: 'P4', name: 'Lower Right 4th Premolar (Carnassial)', roots: 2, size: 'carnassial', svgX: 239, svgY: 268 },
  { id: 409, quadrant: 'LR', jaw: 'lower', type: 'M1', name: 'Lower Right 1st Molar',   roots: 2, size: 'molar-sm',  svgX: 198, svgY: 260 },
  // 410, 411 do not exist in cats
];
