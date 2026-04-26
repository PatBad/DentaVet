// Modified Triadan System — Dogs (42 adult teeth)
// SVG viewBox: 0 0 900 480
// Orientation: patient's right on viewer's LEFT (standard dental orientation)
// Upper jaw: top half (y ~60–170), Lower jaw: bottom half (y ~250–360)
// Quadrants: UR=100s, UL=200s, LL=300s, LR=400s

// roots: number of roots (affects furcation eligibility — only multi-rooted teeth can have furcation)
// type: tooth type abbreviation
// name: display name
// svgX, svgY: crown center in SVG coordinates
// jaw: 'upper' | 'lower'
// quadrant: 'UR' | 'UL' | 'LL' | 'LR'
// size: relative crown size category (affects SVG shape dimensions)

export const DOGS = [
  // ── UPPER RIGHT (100s) — patient's right = viewer's LEFT ──────────────────
  { id: 101, quadrant: 'UR', jaw: 'upper', type: 'I1', name: 'Upper Right 1st Incisor',  roots: 1, size: 'incisor',   svgX: 430, svgY: 88  },
  { id: 102, quadrant: 'UR', jaw: 'upper', type: 'I2', name: 'Upper Right 2nd Incisor',  roots: 1, size: 'incisor',   svgX: 405, svgY: 82  },
  { id: 103, quadrant: 'UR', jaw: 'upper', type: 'I3', name: 'Upper Right 3rd Incisor',  roots: 1, size: 'incisor',   svgX: 377, svgY: 79  },
  { id: 104, quadrant: 'UR', jaw: 'upper', type: 'C',  name: 'Upper Right Canine',       roots: 1, size: 'canine',    svgX: 340, svgY: 98  },
  { id: 105, quadrant: 'UR', jaw: 'upper', type: 'P1', name: 'Upper Right 1st Premolar', roots: 1, size: 'premolar',  svgX: 304, svgY: 120 },
  { id: 106, quadrant: 'UR', jaw: 'upper', type: 'P2', name: 'Upper Right 2nd Premolar', roots: 2, size: 'premolar',  svgX: 271, svgY: 132 },
  { id: 107, quadrant: 'UR', jaw: 'upper', type: 'P3', name: 'Upper Right 3rd Premolar', roots: 2, size: 'premolar',  svgX: 233, svgY: 141 },
  { id: 108, quadrant: 'UR', jaw: 'upper', type: 'P4', name: 'Upper Right 4th Premolar (Carnassial)', roots: 3, size: 'carnassial', svgX: 183, svgY: 150 },
  { id: 109, quadrant: 'UR', jaw: 'upper', type: 'M1', name: 'Upper Right 1st Molar',   roots: 3, size: 'molar',     svgX: 139, svgY: 157 },
  { id: 110, quadrant: 'UR', jaw: 'upper', type: 'M2', name: 'Upper Right 2nd Molar',   roots: 2, size: 'molar-sm',  svgX: 101, svgY: 160 },

  // ── UPPER LEFT (200s) — patient's left = viewer's RIGHT ───────────────────
  { id: 201, quadrant: 'UL', jaw: 'upper', type: 'I1', name: 'Upper Left 1st Incisor',   roots: 1, size: 'incisor',   svgX: 470, svgY: 88  },
  { id: 202, quadrant: 'UL', jaw: 'upper', type: 'I2', name: 'Upper Left 2nd Incisor',   roots: 1, size: 'incisor',   svgX: 495, svgY: 82  },
  { id: 203, quadrant: 'UL', jaw: 'upper', type: 'I3', name: 'Upper Left 3rd Incisor',   roots: 1, size: 'incisor',   svgX: 523, svgY: 79  },
  { id: 204, quadrant: 'UL', jaw: 'upper', type: 'C',  name: 'Upper Left Canine',        roots: 1, size: 'canine',    svgX: 560, svgY: 98  },
  { id: 205, quadrant: 'UL', jaw: 'upper', type: 'P1', name: 'Upper Left 1st Premolar',  roots: 1, size: 'premolar',  svgX: 596, svgY: 120 },
  { id: 206, quadrant: 'UL', jaw: 'upper', type: 'P2', name: 'Upper Left 2nd Premolar',  roots: 2, size: 'premolar',  svgX: 629, svgY: 132 },
  { id: 207, quadrant: 'UL', jaw: 'upper', type: 'P3', name: 'Upper Left 3rd Premolar',  roots: 2, size: 'premolar',  svgX: 667, svgY: 141 },
  { id: 208, quadrant: 'UL', jaw: 'upper', type: 'P4', name: 'Upper Left 4th Premolar (Carnassial)', roots: 3, size: 'carnassial', svgX: 717, svgY: 150 },
  { id: 209, quadrant: 'UL', jaw: 'upper', type: 'M1', name: 'Upper Left 1st Molar',    roots: 3, size: 'molar',     svgX: 761, svgY: 157 },
  { id: 210, quadrant: 'UL', jaw: 'upper', type: 'M2', name: 'Upper Left 2nd Molar',    roots: 2, size: 'molar-sm',  svgX: 799, svgY: 160 },

  // ── LOWER LEFT (300s) — patient's left = viewer's RIGHT ───────────────────
  { id: 301, quadrant: 'LL', jaw: 'lower', type: 'I1', name: 'Lower Left 1st Incisor',   roots: 1, size: 'incisor',   svgX: 470, svgY: 330 },
  { id: 302, quadrant: 'LL', jaw: 'lower', type: 'I2', name: 'Lower Left 2nd Incisor',   roots: 1, size: 'incisor',   svgX: 495, svgY: 336 },
  { id: 303, quadrant: 'LL', jaw: 'lower', type: 'I3', name: 'Lower Left 3rd Incisor',   roots: 1, size: 'incisor',   svgX: 523, svgY: 340 },
  { id: 304, quadrant: 'LL', jaw: 'lower', type: 'C',  name: 'Lower Left Canine',        roots: 1, size: 'canine',    svgX: 560, svgY: 318 },
  { id: 305, quadrant: 'LL', jaw: 'lower', type: 'P1', name: 'Lower Left 1st Premolar',  roots: 1, size: 'premolar',  svgX: 596, svgY: 298 },
  { id: 306, quadrant: 'LL', jaw: 'lower', type: 'P2', name: 'Lower Left 2nd Premolar',  roots: 2, size: 'premolar',  svgX: 629, svgY: 286 },
  { id: 307, quadrant: 'LL', jaw: 'lower', type: 'P3', name: 'Lower Left 3rd Premolar',  roots: 2, size: 'premolar',  svgX: 667, svgY: 275 },
  { id: 308, quadrant: 'LL', jaw: 'lower', type: 'P4', name: 'Lower Left 4th Premolar (Carnassial)', roots: 2, size: 'carnassial', svgX: 710, svgY: 264 },
  { id: 309, quadrant: 'LL', jaw: 'lower', type: 'M1', name: 'Lower Left 1st Molar',    roots: 2, size: 'molar',     svgX: 750, svgY: 257 },
  { id: 310, quadrant: 'LL', jaw: 'lower', type: 'M2', name: 'Lower Left 2nd Molar',    roots: 2, size: 'molar-sm',  svgX: 786, svgY: 252 },
  { id: 311, quadrant: 'LL', jaw: 'lower', type: 'M3', name: 'Lower Left 3rd Molar',    roots: 2, size: 'molar-sm',  svgX: 817, svgY: 249 },

  // ── LOWER RIGHT (400s) — patient's right = viewer's LEFT ─────────────────
  { id: 401, quadrant: 'LR', jaw: 'lower', type: 'I1', name: 'Lower Right 1st Incisor',  roots: 1, size: 'incisor',   svgX: 430, svgY: 330 },
  { id: 402, quadrant: 'LR', jaw: 'lower', type: 'I2', name: 'Lower Right 2nd Incisor',  roots: 1, size: 'incisor',   svgX: 405, svgY: 336 },
  { id: 403, quadrant: 'LR', jaw: 'lower', type: 'I3', name: 'Lower Right 3rd Incisor',  roots: 1, size: 'incisor',   svgX: 377, svgY: 340 },
  { id: 404, quadrant: 'LR', jaw: 'lower', type: 'C',  name: 'Lower Right Canine',       roots: 1, size: 'canine',    svgX: 340, svgY: 318 },
  { id: 405, quadrant: 'LR', jaw: 'lower', type: 'P1', name: 'Lower Right 1st Premolar', roots: 1, size: 'premolar',  svgX: 304, svgY: 298 },
  { id: 406, quadrant: 'LR', jaw: 'lower', type: 'P2', name: 'Lower Right 2nd Premolar', roots: 2, size: 'premolar',  svgX: 271, svgY: 286 },
  { id: 407, quadrant: 'LR', jaw: 'lower', type: 'P3', name: 'Lower Right 3rd Premolar', roots: 2, size: 'premolar',  svgX: 233, svgY: 275 },
  { id: 408, quadrant: 'LR', jaw: 'lower', type: 'P4', name: 'Lower Right 4th Premolar (Carnassial)', roots: 2, size: 'carnassial', svgX: 190, svgY: 264 },
  { id: 409, quadrant: 'LR', jaw: 'lower', type: 'M1', name: 'Lower Right 1st Molar',   roots: 2, size: 'molar',     svgX: 150, svgY: 257 },
  { id: 410, quadrant: 'LR', jaw: 'lower', type: 'M2', name: 'Lower Right 2nd Molar',   roots: 2, size: 'molar-sm',  svgX: 114, svgY: 252 },
  { id: 411, quadrant: 'LR', jaw: 'lower', type: 'M3', name: 'Lower Right 3rd Molar',   roots: 2, size: 'molar-sm',  svgX: 83,  svgY: 249 },
];
