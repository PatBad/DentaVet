// content.js — Ezyvet DOM bridge
// Strategy: right-click each tooth in Ezyvet's image map → check boxes in the modal → click Add.
// One-time setup: user maps one tooth element so we learn which container holds the polygons.

// Guard against double-injection (background.js may reinject when sendMessage fails)
if (window.__vetDentalBridgeLoaded) {
  chrome.runtime.sendMessage({ action: 'fromContent', payload: { action: 'ezyvetDetected' } });
} else {
  window.__vetDentalBridgeLoaded = true;

chrome.runtime.sendMessage({
  action: 'fromContent',
  payload: { action: 'ezyvetDetected' }
});

// ── Active EzyVet tab scoping ─────────────────────────────────────────────
// EzyVet renders multiple patient records as internal tabs within one Chrome tab.
// The active panel has class "rtabdetails active"; inactive ones are hidden.
// All DOM queries should be scoped to the active panel to avoid charting into
// the wrong patient's dental record.
function getActiveRecordPanel() {
  return document.querySelector('.rtabdetails.active') || document;
}

// ── Message listener ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case 'ping':
      sendResponse({ pong: true });
      break;

    case 'scrapePatientInfo':
      // Lightweight scrape — just patient name & species from EzyVet sidebars
      (() => {
        try {
          const root = getActiveRecordPanel();
          const docs = [root];
          if (root !== document) docs.push(document);

          for (const doc of docs) {
            let patientName = null, species = null;

            const patSidebar = doc.querySelector('[id^="patientSideBar"]');
            if (patSidebar) {
              const spans = patSidebar.querySelectorAll(':scope > span');
              for (const sp of spans) {
                const raw = sp.textContent.trim();
                if (!raw || sp.className) continue;
                patientName = raw.replace(/\s*\([^)]+\)\s*$/, '').trim();
                break;
              }
              const bodyText = patSidebar.textContent || '';
              if (/Feline|Cat/i.test(bodyText)) species = 'cat';
              else if (/Canine|Dog/i.test(bodyText)) species = 'dog';
            }

            if (patientName) {
              sendResponse({ patientName, species });
              return;
            }
          }
          sendResponse({ error: 'Patient info not found on page' });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;

    case 'fillDentalChart':
      // Respond immediately — long async ops will close the channel otherwise
      sendResponse({ started: true });
      fillDentalChart(message.chartData).then(result => {
        // Write to storage first (reliable even if service worker is dormant)
        chrome.storage.local.set({ pushResult: { result, ts: Date.now() } });
        // Also attempt message relay (faster path)
        try { chrome.runtime.sendMessage({ action: 'fromContent', payload: { action: 'pushComplete', result } }); } catch (_) {}
      });
      break;

    case 'buildToothMap':
      sendResponse({ started: true });
      rebuildToothMap().then(result => {
        chrome.runtime.sendMessage({ action: 'fromContent', payload: { action: 'buildMapComplete', result } });
      });
      break;

    case 'discoverToothMap':
      sendResponse({ started: true });
      runDiscoverToothMap(message.pattern, message.species || 'dog').then(result => {
        chrome.storage.local.set({ discoverResult: { result, ts: Date.now() } });
        try { chrome.runtime.sendMessage({ action: 'fromContent', payload: { action: 'discoverComplete', result } }); } catch (_) {}
      });
      break;

    case 'scrapeEzyvetDental':
      // Scrape dental findings from the EzyVet "Notes For Mouth" table
      (() => {
        try {
          const root = getActiveRecordPanel();
          const docs = [root];
          if (root !== document) docs.push(document);
          for (const frame of document.querySelectorAll('iframe')) {
            try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch (_) {}
          }

          let tableEl = null;
          let patientInfo = null;

          for (const doc of docs) {
            // Find the notes table — look for a table near "Notes For Mouth" heading
            if (!tableEl) {
              // The table rows are inside a table with Date/Time, Summary, Last Update columns
              const tables = doc.querySelectorAll('table');
              for (const t of tables) {
                const headerText = t.textContent || '';
                if (/Date\/?Time/i.test(headerText) && /Summary/i.test(headerText)) {
                  tableEl = t;
                  break;
                }
              }
            }

            // Scrape patient info from the sidebars
            if (!patientInfo) {
              let patientName = null, species = null, patientId = null,
                  dob = null, age = null, weight = null, breed = null, sex = null,
                  ownerName = null, clinicName = null, veterinarian = null;

              // ── Patient sidebar ──
              const patSidebar = doc.querySelector('[id^="patientSideBar"]');
              if (patSidebar) {
                // Find the name span — skip icon/button spans (they have classes)
                const spans = patSidebar.querySelectorAll(':scope > span');
                for (const sp of spans) {
                  const raw = sp.textContent.trim();
                  if (!raw || sp.className) continue;
                  const sexMatch = raw.match(/\(([^)]+)\)\s*$/);
                  if (sexMatch) {
                    sex = sexMatch[1];
                    patientName = raw.replace(/\s*\([^)]+\)\s*$/, '').trim();
                  } else {
                    patientName = raw;
                  }
                  break;
                }
                const texts = [];
                for (const node of patSidebar.childNodes) {
                  if (node.nodeType === 3) {
                    const t = node.textContent.trim();
                    if (t) texts.push(t);
                  }
                }
                for (const t of texts) {
                  const idM = t.match(/Patient\s*ID:\s*(\d+)/i);
                  if (idM) { patientId = idM[1]; continue; }
                  const dobM = t.match(/Date\s*of\s*Birth:\s*([\d-]+)/i);
                  if (dobM) { dob = dobM[1]; continue; }
                  const ageWt = t.match(/^([\d]+\s*years?\s*[\d]+\s*months?.*?)\s*-\s*([\d.]+\s*kg)/i);
                  if (ageWt) { age = ageWt[1].trim(); weight = ageWt[2].trim(); continue; }
                  const breedM = t.match(/(Feline|Canine)\s*\([^)]+\)\s*-\s*\S+\s*-\s*(.+)/i);
                  if (breedM) {
                    species = /feline/i.test(breedM[1]) ? 'cat' : 'dog';
                    breed = breedM[2].trim();
                    continue;
                  }
                  if (!species && /Feline|Cat/i.test(t)) species = 'cat';
                  if (!species && /Canine|Dog/i.test(t)) species = 'dog';
                }
              }

              // ── Owner sidebar ──
              const ownerSidebar = doc.querySelector('[id^="ownerSideBar"]');
              if (ownerSidebar) {
                const ownerSpan = ownerSidebar.querySelector('span');
                if (ownerSpan) ownerName = ownerSpan.textContent.trim();
              }

              // ── Consult sidebar ──
              const consultSidebar = doc.querySelector('[id^="consultSideBar"]');
              if (consultSidebar) {
                const spans = consultSidebar.querySelectorAll('span');
                for (const sp of spans) {
                  const txt = sp.textContent.trim();
                  const caseM = txt.match(/Case\s*Owner:\s*(.+)/i);
                  if (caseM) { veterinarian = caseM[1].trim(); }
                  else if (!clinicName && txt.length > 0) { clinicName = txt; }
                }
              }

              // ── Fallback: body-text scraping if sidebars not found ──
              if (!patientName) {
                const bodyText = doc.body?.textContent || '';
                const nameEl = doc.querySelector('.patient-name, [class*="patient"] [class*="name"]');
                patientName = nameEl?.textContent?.trim() || null;
                if (!patientName) {
                  const m = bodyText.match(/Patient\s*\n\s*(.+?)(?:\n|Patient ID)/s);
                  if (m) patientName = m[1].trim();
                }
                if (!species) {
                  if (/Feline|Cat/i.test(bodyText)) species = 'cat';
                  else if (/Canine|Dog/i.test(bodyText)) species = 'dog';
                }
              }

              if (patientName || species) {
                patientInfo = {
                  patientName, species, patientId, dob, age, weight,
                  sex, breed, ownerName, clinicName, veterinarian
                };
              }
            }
          }

          if (!tableEl) {
            sendResponse({ error: 'Notes For Mouth table not found — is the Dental tab open in EzyVet?' });
            return;
          }

          const rows = tableEl.querySelectorAll('tbody tr, tr');
          const teeth = [];

          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 2) continue;

            const summaryCell = cells[1]; // Summary column
            const summaryText = summaryCell?.innerText || summaryCell?.textContent || '';

            // Extract tooth number: "Tooth: 407 Notes"
            const toothMatch = summaryText.match(/Tooth:\s*(\d{3})/);
            if (!toothMatch) continue;

            const toothId = parseInt(toothMatch[1], 10);
            const lines = summaryText.split('\n').map(l => l.trim()).filter(Boolean);

            const findings = [];
            const procedures = [];

            for (const line of lines) {
              // Skip header lines
              if (/^Tooth:\s*\d{3}/i.test(line)) continue;
              if (/^Notes$/i.test(line)) continue;

              // Periodontitis:PD1, Periodontitis:PD3
              const pdMatch = line.match(/Periodontitis:\s*(PD\d)/i);
              if (pdMatch) { findings.push(pdMatch[1]); continue; }

              // Resorption:TR3
              const trMatch = line.match(/Resorption:\s*(TR\d)/i);
              if (trMatch) { findings.push(trMatch[1]); continue; }

              // Furcation:F1
              const furcMatch = line.match(/Furcation:\s*(F\d)/i);
              if (furcMatch) { findings.push(furcMatch[1]); continue; }

              // Mobility:M1
              const mobMatch = line.match(/Mobility:\s*(M\d)/i);
              if (mobMatch) { findings.push(mobMatch[1]); continue; }

              // Fracture:CCF
              const fracMatch = line.match(/Fracture:\s*(\w+)/i);
              if (fracMatch) { findings.push(fracMatch[1]); continue; }

              // Tooth State:Extracted
              if (/Tooth\s*State:\s*Extracted/i.test(line)) { findings.push('Extracted'); continue; }

              // Free-text line with pipes: "T1 | Extraction: surgical | Flap"
              if (line.includes('|')) {
                const parts = line.split('|').map(p => p.trim()).filter(Boolean);
                for (const part of parts) {
                  if (/^T[12]$/i.test(part)) { findings.push(part.toUpperCase()); continue; }
                  if (/Extraction:\s*(surgical|simple)/i.test(part)) {
                    const em = part.match(/Extraction:\s*(surgical|simple)/i);
                    procedures.push(`Extraction (${em[1]})`);
                    continue;
                  }
                  // Periodontal procedures
                  if (/^(PRO|RP\/C|RP\/O|GC|Flap)$/i.test(part)) {
                    procedures.push(part);
                    continue;
                  }
                  // Anything else as a finding
                  findings.push(part);
                }
                continue;
              }

              // Standalone "Missing"
              if (/^Missing$/i.test(line)) { findings.push('Missing'); continue; }
            }

            // Extract date from first column
            const dateCell = cells[0];
            const dateText = dateCell?.innerText || dateCell?.textContent || '';

            teeth.push({ toothId, findings, procedures, date: dateText.trim() });
          }

          sendResponse({ teeth, patientInfo, count: teeth.length });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true; // async

    case 'grabDentalChartHtml':
      // Grab the EzyVet dental chart as a composite image.
      // EzyVet renders: a GIF background-image on an SVG + CSS-classed polygons for overlays
      //   .hasNotes → red stroke    .extracted → black fill
      // We composite both layers onto a canvas and return a data-URI PNG.
      //
      // After navigation or a push (which triggers refreshDentalTab), EzyVet
      // dynamically re-renders the dental chart. The SVG element and/or its
      // background-image may not exist yet. We poll for up to 8 seconds to
      // allow the chart to finish loading before giving up.
      (async () => {
        try {
          // Poll for the SVG element with a background-image for up to 8 seconds
          let svgEl = null;
          let ownerDoc = null;
          const MAX_ATTEMPTS = 32;      // 32 × 250ms = 8s
          const POLL_INTERVAL = 250;

          for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const root = getActiveRecordPanel();
            const docs = [root];
            if (root !== document) docs.push(document);
            for (const frame of document.querySelectorAll('iframe')) {
              try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch (_) {}
            }

            for (const doc of docs) {
              const candidate = doc.querySelector('svg.imageMapImage') || doc.querySelector('svg[style*="background-image"]');
              if (!candidate) continue;

              // Verify the SVG actually has a background-image (not just the element existing)
              const style = candidate.getAttribute('style') || '';
              const cs = window.getComputedStyle(candidate);
              const hasBg = /background-image:\s*url\(/i.test(style)
                         || (cs.backgroundImage && cs.backgroundImage !== 'none');
              if (hasBg) {
                svgEl = candidate;
                ownerDoc = doc;
                break;
              }
            }

            if (svgEl) break;
            await sleep(POLL_INTERVAL);
          }

          if (!svgEl) {
            sendResponse({ error: 'Dental chart image not found on page' });
            return;
          }

          // 1. Extract the background-image URL
          const style = svgEl.getAttribute('style') || '';
          const cs = window.getComputedStyle(svgEl);
          const bgMatch = style.match(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/i)
                       || cs.backgroundImage.match(/url\(['"]?([^'")]+)['"]?\)/i);
          if (!bgMatch) {
            sendResponse({ error: 'Dental chart SVG found but background-image URL could not be extracted' });
            return;
          }

          let imgUrl = bgMatch[1];
          if (!imgUrl.startsWith('http')) imgUrl = new URL(imgUrl, (ownerDoc || document).baseURI).href;

          // 2. Fetch the GIF and load as an Image
          const gifBlob = await fetch(imgUrl, { credentials: 'include' }).then(r => r.blob());
          const gifDataUri = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(gifBlob);
          });

          const bgImg = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = gifDataUri;
          });

          // 3. Create canvas at SVG dimensions
          const w = parseInt(svgEl.getAttribute('width')) || bgImg.width;
          const h = parseInt(svgEl.getAttribute('height')) || bgImg.height;
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');

          // 4. Draw the GIF base layer
          ctx.drawImage(bgImg, 0, 0, w, h);

          // 5. Draw polygon overlays with their computed styles
          for (const poly of svgEl.querySelectorAll('polygon')) {
            const pcs = window.getComputedStyle(poly);
            const hasFill = pcs.fill && pcs.fill !== 'rgba(0, 0, 0, 0)' && pcs.fill !== 'none';
            const hasStroke = pcs.stroke && pcs.stroke !== 'none';
            if (!hasFill && !hasStroke) continue;

            const points = poly.getAttribute('points');
            if (!points) continue;
            const coords = points.trim().split(/[\s,]+/).map(Number);
            if (coords.length < 4) continue;

            ctx.beginPath();
            ctx.moveTo(coords[0], coords[1]);
            for (let i = 2; i < coords.length; i += 2) {
              ctx.lineTo(coords[i], coords[i + 1]);
            }
            ctx.closePath();

            if (hasFill) {
              ctx.globalAlpha = parseFloat(pcs.opacity) || 1;
              ctx.fillStyle = pcs.fill;
              ctx.fill();
            }
            if (hasStroke) {
              ctx.globalAlpha = parseFloat(pcs.opacity) || 1;
              ctx.strokeStyle = pcs.stroke;
              ctx.lineWidth = parseFloat(pcs.strokeWidth) || 1;
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }

          // 6. Export as PNG data URI
          const dataUri = canvas.toDataURL('image/png');
          sendResponse({ html: `<img src="${dataUri}" style="max-width:100%;max-height:280px;">` });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;

    case 'startDOMInspector':
      startInspector(sendResponse);
      return true;

    case 'startMultiToothInspector':
      startMultiToothInspector(message.species, message.existingMap || {}, sendResponse);
      return true;
  }
});

// ── Fill Dental Chart ──────────────────────────────────────────────────────
async function fillDentalChart(chartData) {
  const species = chartData.species || 'dog';
  // Build or load the complete tooth→selector map for this species
  let toothMap = await loadToothMap(species);
  if (!toothMap || Object.keys(toothMap).length === 0) {
    const pattern = await loadToothPattern();
    if (!pattern) return { error: `No tooth map for ${species}. Use "Map All Teeth Manually" on the ${species} chart first.` };
    toothMap = buildFullToothMap(pattern, species);
    if (!toothMap) return { error: 'Could not build tooth selector map. Make sure the Ezyvet dental chart is visible and try again.' };
    await saveToothMap(toothMap, species);
  }

  const teethWithData = Object.entries(chartData.teeth).filter(([, data]) => !isToothEmpty(data));
  if (teethWithData.length === 0) return { error: 'No findings to push.' };

  let pushed = 0;
  const errors = [];

  for (const [toothId, toothData] of teethWithData) {
    // Send progress update so the side panel can show which tooth is being processed
    chrome.runtime.sendMessage({
      action: 'fromContent',
      payload: { action: 'pushProgress', current: pushed + errors.length + 1, total: teethWithData.length, toothId }
    });
    const result = await processOneTooth(parseInt(toothId, 10), toothData, toothMap, chartData.species);
    if (result.ok) pushed++;
    else errors.push(`${toothId}: ${result.error}`);
    await sleep(150);
  }

  // Refresh the active Dental sub-tab so EzyVet re-renders findings
  await refreshDentalTab();

  if (errors.length) return { pushed, errors };
  return { ok: true, pushed };
}

// Refresh the active EzyVet record tab so newly saved findings become visible.
// Simulates right-clicking the focused tab header to open EzyVet's context menu,
// then clicks the "Refresh" option — the same action a user would take.
async function refreshDentalTab() {
  const tab = document.querySelector('.focusedRecordTab');
  if (!tab) return;

  // Right-click the tab to open EzyVet's custom context menu
  const rect = tab.getBoundingClientRect();
  const cx = Math.round(rect.left + rect.width / 2);
  const cy = Math.round(rect.top + rect.height / 2);
  tab.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: cx, clientY: cy,
    button: 2
  }));

  // Wait for the context menu to appear, then click "Refresh"
  for (let i = 0; i < 10; i++) {
    await sleep(100);
    // Find the "Refresh" option in the context menu
    const allEls = document.querySelectorAll('p, a, li, div, span');
    for (const el of allEls) {
      if (el.textContent.trim() === 'Refresh' && el.getBoundingClientRect().width > 0) {
        el.click();
        await sleep(500);
        return;
      }
    }
  }
}

async function rebuildToothMap() {
  const pattern = await loadToothPattern();
  if (!pattern) return { error: 'No tooth pattern stored.' };
  const map = buildFullToothMap(pattern);
  if (!map) return { error: 'Could not build map — is the Ezyvet dental chart visible?' };
  await saveToothMap(map);
  return { ok: true, count: Object.keys(map).length, map };
}

async function closeOpenModal() {
  const modal = findModal();
  if (!modal) return;

  // Search in the modal's own document (handles iframes correctly)
  const doc = modal.ownerDocument || document;

  // 1. Ezyvet cancel button by ID pattern (try broad selectors)
  const cancelDiv =
    modal.querySelector('[id*="cancel"][id*="Wrapper"], [id*="Cancel"][id*="Wrapper"]') ||
    doc.querySelector('[id*="cancel"][id*="Wrapper"], [id*="Cancel"][id*="Wrapper"]');
  if (cancelDiv && isVisible(cancelDiv)) { cancelDiv.click(); }
  else {
    // 2. Button/link/div with "cancel" text
    let clicked = false;
    for (const el of doc.querySelectorAll('button, input[type="button"], input[type="reset"], a, div')) {
      if (/^cancel$/i.test(el.textContent?.trim()) && isVisible(el)) { el.click(); clicked = true; break; }
    }
    // 3. Escape key as last resort
    if (!clicked) {
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    }
  }

  // Wait until the modal is actually gone (up to 1500ms)
  for (let t = 0; t < 15; t++) {
    await sleep(100);
    if (!findModal()) return;
  }
}

async function processOneTooth(toothId, toothData, toothMap, species) {
  await closeOpenModal(); // dismiss any modal left open from a previous tooth

  const toothEl = findToothElement(toothId, toothMap);
  if (!toothEl) return { error: `Tooth element not found for ${toothId}` };

  // Step 1: Left-click the polygon to select the tooth (updates "Notes For Tooth: NNN" panel)
  const toothRect = toothEl.getBoundingClientRect();
  const cx = Math.round(toothRect.left + toothRect.width / 2);
  const cy = Math.round(toothRect.top + toothRect.height / 2);
  toothEl.dispatchEvent(new MouseEvent('click', {
    bubbles: true, cancelable: true,
    clientX: cx, clientY: cy,
    screenX: cx + window.screenX, screenY: cy + window.screenY,
  }));

  // Step 2: Wait for AJAX to land, then poll for the correct tooth number
  await sleep(1200);
  let panelOk = false;
  for (let t = 0; t < 10; t++) {
    await sleep(200);
    if (readToothNumberFromPanel() === toothId) { panelOk = true; break; }
  }
  if (!panelOk) {
    const actual = readToothNumberFromPanel();
    return { error: `Panel shows tooth ${actual ?? 'null'} not ${toothId} — map may need rediscovery` };
  }

  // Step 3: Click the "+" (AddNotesForTooth) button to open the findings modal
  const addBtn = getActiveRecordPanel().querySelector('[data-testid="AddNotesForTooth"]');
  if (!addBtn) return { error: `Add button not found for tooth ${toothId}` };
  addBtn.click();

  const modal = await waitForModal(3000);
  if (!modal) return { error: `Modal did not open for tooth ${toothId}` };

  const notes = buildNotesText(toothId, toothData, species);
  fillModal(modal, toothData, notes);
  await sleep(300);

  await clickSaveButton(modal);
  await sleep(1000); // wait for Ezyvet to save and close the modal
  return { ok: true };
}

// ── Full Tooth Map Builder ─────────────────────────────────────────────────
// Given the one mapped tooth pattern, builds a complete { toothNumber → cssSelector } map.
// Primary strategy: match polygon centers to DOM text labels.
// Fallback: sort polygons by screen position and assign using known Triadan arch order.
function buildFullToothMap(pattern, species) {
  const { sampleId, sampleSelector } = pattern;
  if (!sampleSelector) return null;

  // Split "CONTAINER > CHILD:nth-of-type(N)" at the last ">"
  const lastArrow = sampleSelector.lastIndexOf('>');
  if (lastArrow === -1) return null;

  const containerSelector = sampleSelector.substring(0, lastArrow).trim();
  const childPart = sampleSelector.substring(lastArrow + 1).trim();
  const childTag = childPart.split(':')[0].trim() || 'polygon';

  // Find the container in the active panel or any iframe within it
  let container = null;
  let ownerDoc = document;
  const root = getActiveRecordPanel();

  try { container = root.querySelector(containerSelector); } catch (_) {}
  if (!container) {
    for (const frame of root.querySelectorAll('iframe')) {
      try {
        const doc = frame.contentDocument;
        if (!doc) continue;
        try { container = doc.querySelector(containerSelector); } catch (_) {}
        if (container) { ownerDoc = doc; break; }
      } catch (_) {}
    }
  }
  if (!container) return null;

  // Collect direct children only (nested polygons would skew nth-of-type indices)
  const children = Array.from(container.querySelectorAll(':scope > ' + childTag));
  if (!children.length) return null;

  // Strategy 1: position-based geometric mapping (primary — most reliable)
  const posMap = buildPositionBasedMap(children, containerSelector, childTag, sampleId, sampleSelector, species || 'dog');
  if (posMap && Object.keys(posMap).length > 1) return posMap;

  // Strategy 2: nearest DOM text label (fallback — unreliable if labels are raster or
  // page content contains accidental tooth-number-shaped values like record IDs)
  const toothLabels = gatherToothLabels(ownerDoc);
  if (toothLabels.length > 0) {
    const map = {};
    children.forEach((child, zeroIndex) => {
      const rect = child.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let nearest = null, minDist = Infinity;
      for (const label of toothLabels) {
        const dist = Math.hypot(cx - label.x, cy - label.y);
        if (dist < minDist) { minDist = dist; nearest = label; }
      }
      if (nearest && minDist < 250) {
        map[nearest.number] = `${containerSelector} > ${childTag}:nth-of-type(${zeroIndex + 1})`;
      }
    });
    if (Object.keys(map).length > 0) {
      map[sampleId] = sampleSelector;
      return map;
    }
  }

  return { [sampleId]: sampleSelector };
}

// Known left-to-right tooth sequences for each arch (viewer's perspective: patient right = viewer left)
const ARCH_SEQUENCES = {
  cat: {
    upper: [109, 108, 107, 106, 104, 103, 102, 101, 201, 202, 203, 204, 206, 207, 208, 209],
    lower: [409, 408, 407, 404, 403, 402, 401, 301, 302, 303, 304, 307, 308, 309]
  },
  dog: {
    upper: [110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210],
    lower: [411, 410, 409, 408, 407, 406, 405, 404, 403, 402, 401, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311]
  }
};

function buildPositionBasedMap(children, containerSelector, childTag, sampleId, sampleSelector, species) {
  const seqs = ARCH_SEQUENCES[species] || ARCH_SEQUENCES.dog;

  // Collect all rendered polygon positions
  const items = [];
  children.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    items.push({ index: i + 1, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  });

  if (items.length < seqs.upper.length + seqs.lower.length) {
    // Fewer polygons than expected teeth — can't map reliably
    return { [sampleId]: sampleSelector };
  }

  // Find the largest Y gap between consecutive items — that's the oral cavity
  // dividing the upper arch (smaller Y) from the lower arch (larger Y)
  const sortedByY = [...items].sort((a, b) => a.y - b.y);
  let maxGap = 0, splitAt = Math.floor(items.length / 2);
  for (let i = 1; i < sortedByY.length; i++) {
    const gap = sortedByY[i].y - sortedByY[i - 1].y;
    if (gap > maxGap) { maxGap = gap; splitAt = i; }
  }

  const upperCandidates = sortedByY.slice(0, splitAt);
  const lowerCandidates = sortedByY.slice(splitAt);

  // When there are extra polygons (roots, borders), select the crown row:
  //   Upper arch: crowns hang DOWN toward the oral cavity → keep items with LARGEST Y
  //   Lower arch: crowns reach UP toward the oral cavity → keep items with SMALLEST Y
  function trimUpper(candidates, count) {
    if (candidates.length < count) return null;
    return [...candidates].sort((a, b) => b.y - a.y).slice(0, count); // largest Y first
  }
  function trimLower(candidates, count) {
    if (candidates.length < count) return null;
    return [...candidates].sort((a, b) => a.y - b.y).slice(0, count); // smallest Y first
  }

  const upperItems = trimUpper(upperCandidates, seqs.upper.length);
  const lowerItems = trimLower(lowerCandidates, seqs.lower.length);
  if (!upperItems || !lowerItems) return { [sampleId]: sampleSelector };

  upperItems.sort((a, b) => a.x - b.x);
  lowerItems.sort((a, b) => a.x - b.x);

  const map = {};
  seqs.upper.forEach((tooth, i) => {
    map[tooth] = `${containerSelector} > ${childTag}:nth-of-type(${upperItems[i].index})`;
  });
  seqs.lower.forEach((tooth, i) => {
    map[tooth] = `${containerSelector} > ${childTag}:nth-of-type(${lowerItems[i].index})`;
  });

  // Always trust the one manually mapped tooth
  map[sampleId] = sampleSelector;
  return map;
}

function gatherToothLabels(doc) {
  const labels = [];
  const seen = new Set();

  // Walk ALL text nodes in the document — catches <span>, <text>, <tspan>, <div>, etc.
  // This is the most robust approach regardless of whether labels are SVG or HTML.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent?.trim();
    if (!text) continue;
    const num = parseInt(text, 10);
    if (!isValidToothNumber(num) || String(num) !== text || seen.has(num)) continue;
    const el = node.parentElement;
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    // Skip if not rendered
    if (rect.width === 0 && rect.height === 0) continue;
    labels.push({ number: num, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    seen.add(num);
  }

  // Fallback: polygon/path <title> children (SVG accessibility titles)
  if (labels.length === 0) {
    for (const el of doc.querySelectorAll('polygon > title, path > title, use > title')) {
      const text = el.textContent?.trim();
      const num = parseInt(text, 10);
      if (isValidToothNumber(num) && !seen.has(num)) {
        const parent = el.parentElement;
        if (parent) {
          const rect = parent.getBoundingClientRect();
          labels.push({ number: num, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
          seen.add(num);
        }
      }
    }
  }

  // Fallback: aria-label, data-tooth, title attributes
  if (labels.length === 0) {
    for (const el of doc.querySelectorAll('[aria-label], [data-tooth], [title]')) {
      const raw = el.getAttribute('data-tooth') || el.getAttribute('aria-label') || el.getAttribute('title');
      const num = parseInt(raw, 10);
      if (isValidToothNumber(num) && String(num) === raw?.trim() && !seen.has(num)) {
        const rect = el.getBoundingClientRect();
        labels.push({ number: num, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        seen.add(num);
      }
    }
  }

  return labels;
}

function isValidToothNumber(n) {
  if (!Number.isInteger(n)) return false;
  // Triadan quadrant digits are 1-9 (last two digits of tooth number)
  const last2 = n % 100;
  if (last2 < 1 || last2 > 11) return false;
  const quadrant = Math.floor(n / 100);
  // Adult: quadrants 1-4 (100s–400s). Deciduous: 5-8 (500s–800s).
  return quadrant >= 1 && quadrant <= 4; // adult teeth only — excludes deciduous (5-8)
}

function getSampleIndex(selector) {
  const m = selector.match(/:nth-of-type\((\d+)\)/);
  return m ? parseInt(m[1], 10) : null;
}

// ── Tooth Element Finder ───────────────────────────────────────────────────
function findToothElement(toothId, toothMap) {
  // Primary: direct lookup using stored selector
  const selector = toothMap && toothMap[toothId];
  if (selector) {
    const el = findInDocumentAndFrames(selector);
    if (el) return el;
    // The stored selector includes a parent ID (e.g. #imageMapImage85) that Ezyvet
    // generates dynamically per dental record — it changes for each patient.
    // Retry with just the imagemapitem attribute, which is stable across patients.
    const m = selector.match(/polygon\[imagemapitem="([^"]+)"\]/);
    if (m) {
      const el2 = findInDocumentAndFrames(`polygon[imagemapitem="${m[1]}"]`);
      if (el2) return el2;
    }
  }

  // Last resort: scan DOM for elements containing the tooth number as text/attribute
  return findToothByContent(toothId);
}

function findToothByContent(toothId) {
  const id = String(toothId);
  const root = getActiveRecordPanel();

  for (const area of root.querySelectorAll('area')) {
    if (area.alt === id || area.title === id || area.getAttribute('data-tooth') === id) return area;
  }

  for (const el of root.querySelectorAll(`[data-tooth="${id}"], [aria-label="${id}"]`)) {
    return el;
  }

  for (const el of root.querySelectorAll('text, tspan')) {
    if (el.textContent?.trim() === id) {
      let parent = el.parentElement;
      while (parent && parent.tagName !== 'svg') {
        if (parent.onclick || parent.tagName === 'a' || parent.getAttribute('data-tooth')) return parent;
        parent = parent.parentElement;
      }
    }
  }

  return null;
}

function findInDocumentAndFrames(selector, root) {
  root = root || getActiveRecordPanel();
  let el = null;
  try { el = root.querySelector(selector); } catch (_) {}
  if (el) return el;
  for (const frame of root.querySelectorAll('iframe')) {
    try {
      el = frame.contentDocument?.querySelector(selector);
      if (el) return el;
    } catch (_) {}
  }
  return null;
}

// ── Modal Interaction ──────────────────────────────────────────────────────
async function waitForModal(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const modal = findModal();
    if (modal) return modal;
    await sleep(100);
  }
  return null;
}

function findModal() {
  const root = getActiveRecordPanel();
  const docs = [root];
  for (const frame of root.querySelectorAll('iframe')) {
    try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch (_) {}
  }
  // Also check top-level document for overlay modals that render outside rtabdetails
  if (root !== document) docs.push(document);
  for (const doc of docs) {
    // Ezyvet-specific: popup_content div wrapping a popupForm
    for (const el of doc.querySelectorAll('.popup_content, .elementContent')) {
      if (isVisible(el) && el.querySelector('form[id^="popupForm-"]')) return el;
    }
    // Ezyvet-specific: the form itself
    for (const el of doc.querySelectorAll('form[id^="popupForm-"]')) {
      if (isVisible(el)) return el;
    }
    // Generic fallback
    for (const el of doc.querySelectorAll('[class*="modal"],[class*="dialog"],[role="dialog"]')) {
      if (isVisible(el) && el.querySelector('input[type="checkbox"], input.radio')) return el;
    }
  }
  return null;
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  // Do NOT use offsetParent — it returns null for position:fixed overlays
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function fillModal(modal, toothData, notesText) {
  const f = toothData.findings;
  const p = toothData.procedures;
  const toCheck = [];

  if (f.missing) toCheck.push('Missing');
  if (p.extraction) toCheck.push('Extracted');
  if (f.periodontal?.stage && f.periodontal.stage !== 'PD0') toCheck.push(f.periodontal.stage);
  if (f.furcation && f.furcation !== 'F0') toCheck.push(f.furcation);
  if (f.mobility && f.mobility !== 'M0') toCheck.push(f.mobility);
  if (f.fracture) toCheck.push(f.fracture);
  if (f.toothResorption?.stage) toCheck.push(f.toothResorption.stage);

  toCheck.forEach(value => checkCheckbox(modal, value));

  if (notesText) {
    const textarea = modal.querySelector('textarea');
    if (textarea) setFieldValue(textarea, notesText);
  }
}

// Find and check a checkbox by:
//   1. Name attribute suffix  ][Value]  — Ezyvet's naming convention
//   2. Adjacent text node               — Ezyvet renders text next to <input class="radio">
//   3. Associated <label> element       — standard HTML fallback
function checkCheckbox(container, value) {
  const lower = value.toLowerCase();

  for (const input of container.querySelectorAll('input[type="checkbox"], input.radio')) {
    let match = false;

    // Strategy 1: name ends with ][Value]
    const name = (input.getAttribute('name') || '').toLowerCase();
    if (name.endsWith(`][${lower}]`)) match = true;

    // Strategy 2: adjacent text node (Ezyvet: <input> " Missing ")
    if (!match && input.nextSibling?.nodeType === Node.TEXT_NODE) {
      if (input.nextSibling.textContent.trim().toLowerCase() === lower) match = true;
    }

    // Strategy 3: parent's trimmed text content (ignoring nested inputs)
    if (!match) {
      const parentText = Array.from(input.parentElement?.childNodes || [])
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim()).join(' ').toLowerCase();
      if (parentText === lower) match = true;
    }

    if (match && !input.checked) {
      input.click();
      if (!input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }
  }

  // Strategy 4: <label> element (standard HTML)
  for (const label of container.querySelectorAll('label')) {
    if (label.textContent?.trim().toLowerCase() !== lower) continue;
    let cb = null;
    if (label.htmlFor) try { cb = container.querySelector(`#${CSS.escape(label.htmlFor)}`); } catch (_) {}
    if (!cb) cb = label.querySelector('input');
    if (!cb) cb = label.previousElementSibling?.type === 'checkbox' ? label.previousElementSibling : null;
    if (cb && !cb.checked) { label.click(); if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); } return true; }
  }
  return false;
}

// Click the Ezyvet Add/save button, falling back to form.submit()
async function clickSaveButton(modal) {
  // Ezyvet save button: <div id="saveRecord-NWrapper" class="buttonHolder blueGradient">
  const saveDiv = modal.querySelector('[id*="saveRecord"][id*="Wrapper"]')
    || getActiveRecordPanel().querySelector('[id*="saveRecord"][id*="Wrapper"]');
  if (saveDiv && isVisible(saveDiv)) {
    const r = saveDiv.getBoundingClientRect();
    saveDiv.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2)
    }));
    return;
  }
  // Fallback: any visible button/input with text "Add"
  for (const el of getActiveRecordPanel().querySelectorAll('button, input[type="submit"], input[type="button"]')) {
    if ((el.textContent?.trim() === 'Add' || el.value === 'Add') && isVisible(el)) {
      el.click(); return;
    }
  }
  // Last resort: submit the form directly
  const form = modal.querySelector('form') || (modal.tagName === 'FORM' ? modal : null);
  if (form) form.submit();
}

// ── Notes Text Builder ─────────────────────────────────────────────────────
function buildNotesText(toothId, toothData, species) {
  const parts = [];
  const f = toothData.findings;
  const p = toothData.procedures;

  const pd = f.periodontal?.probingDepths;
  if (pd) {
    const depths = [pd.mesioBuccal, pd.buccal, pd.distoBuccal].filter(v => v != null);
    if (depths.length) parts.push(`Probe: ${depths.join('/')}mm`);
  }

  if (f.toothResorption?.stage && f.toothResorption?.type) {
    parts.push(f.toothResorption.type);
  }

  if (p.extraction) parts.push(`Extraction: ${p.extraction}`);
  if (p.periodontal?.length) parts.push(p.periodontal.join(', '));

  return parts.join(' | ');
}

// ── Helpers ────────────────────────────────────────────────────────────────
function setFieldValue(el, value) {
  try {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (_) {}
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isToothEmpty(t) {
  if (!t) return true;
  const f = t.findings;
  const p = t.procedures;
  return !f.periodontal.stage && !f.periodontal.probingDepths.mesioBuccal &&
         !f.toothResorption.stage && !f.fracture && !f.furcation && !f.mobility &&
         !f.missing && !p.extraction && !p.periodontal.length;
}

// ── Auto-Discovery: left-click each polygon, read "Notes For Tooth: NNN" ──
async function runDiscoverToothMap(pattern, species = 'dog') {
  const { sampleSelector } = pattern || {};
  if (!sampleSelector) return { error: 'No sample selector — map one tooth first' };

  const lastArrow = sampleSelector.lastIndexOf('>');
  if (lastArrow === -1) return { error: 'Invalid selector' };

  const containerSelector = sampleSelector.substring(0, lastArrow).trim();
  const childTag = sampleSelector.substring(lastArrow + 1).trim().split(':')[0].trim() || 'polygon';

  let container = null;
  const root = getActiveRecordPanel();
  try { container = root.querySelector(containerSelector); } catch (_) {}
  if (!container) {
    for (const frame of root.querySelectorAll('iframe')) {
      try { container = frame.contentDocument?.querySelector(containerSelector); if (container) break; } catch (_) {}
    }
  }
  if (!container) return { error: 'Chart container not found — is the Ezyvet dental chart visible?' };

  const children = Array.from(container.querySelectorAll(':scope > ' + childTag));
  const map = {};

  // Pre-compute all rendered polygon areas so we can use a smart threshold.
  // For a dog: 84 polygons = 42 crown + 42 root. We want only crowns (the larger half).
  // Using the median area means: only click polygons larger than 50% of all visible polygons.
  const allAreas = children.map(el => {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  }).filter(a => a > 0).sort((a, b) => a - b);
  const medianArea = allAreas.length ? allAreas[Math.floor(allAreas.length / 2)] : 0;
  // Also hard floor of 200px² to guard against very small SVGs
  // Click all visible polygons (area > 0). The "first match wins" logic below ensures
  // each tooth is mapped only once even if both its crown and root polygons respond.
  // Earlier small-polygon issues were caused by el.click() TypeError, now fixed with dispatchEvent.
  console.log('[VetDental] Auto-Discover: found', children.length, 'polygons in', containerSelector,
    '| area range:', allAreas[0], '–', allAreas[allAreas.length - 1], '| median:', medianArea);

  // Build a sorted list: largest area first so crowns (bigger) are processed before roots (smaller).
  // "First match wins" below ensures that once a tooth is mapped to its crown polygon,
  // subsequent root polygon clicks for the same tooth are ignored.
  const sortedItems = children.map((el, i) => {
    const rect = el.getBoundingClientRect();
    return { el, svgIndex: i + 1, area: rect.width * rect.height };
  }).filter(x => x.area > 0).sort((a, b) => b.area - a.area);

  let processed = 0;
  for (const { el, svgIndex, area } of sortedItems) {
    processed++;
    // Progress via storage (reliable — service worker may be dormant during 40s loop)
    const found = Object.keys(map).length;
    chrome.storage.local.set({ discoverProgress: { current: processed, total: sortedItems.length, found } });
    try { chrome.runtime.sendMessage({ action: 'fromContent', payload: {
      action: 'discoverProgress', current: processed, total: sortedItems.length, found
    }}); } catch (_) {}

    // Read the polygon's imagemapitem attribute — used for the stored selector and fast-path check
    const imagemapItem = el.getAttribute('imagemapitem') || el.getAttribute('data-imagemapitem') || null;

    // Fast path 1: imagemapitem directly equals a Triadan tooth number (101–111 = upper-right)
    let num = null;
    if (imagemapItem) {
      const n = parseInt(imagemapItem, 10);
      if (isValidToothNumber(n)) num = n;
    }

    // Fast path 2: other element attributes
    if (!num) {
      for (const attr of ['title', 'data-tooth', 'data-id', 'aria-label', 'id', 'name']) {
        const val = el.getAttribute(attr) || '';
        const m = val.match(/\b(\d{3})\b/);
        if (m && isValidToothNumber(parseInt(m[1], 10))) { num = parseInt(m[1], 10); break; }
      }
    }

    // Fast path 3: SVG <title> child element (no click needed)
    if (!num) {
      const titleEl = el.querySelector('title');
      if (titleEl) {
        const m = titleEl.textContent.match(/\b(\d{3})\b/);
        if (m && isValidToothNumber(parseInt(m[1], 10))) num = parseInt(m[1], 10);
      }
    }

    if (!num) {
      if (!!el.closest('a[href]')) continue; // link — skip

      const rect2 = el.getBoundingClientRect();
      const cx = Math.round(rect2.left + rect2.width / 2);
      const cy = Math.round(rect2.top  + rect2.height / 2);
      const clickOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy,
                          screenX: cx + window.screenX, screenY: cy + window.screenY };

      // Read prevNum AFTER a short settle so any previous in-flight AJAX has landed
      await sleep(500);
      const prevNum = readToothNumberFromPanel();

      // First click — trigger the panel AJAX
      el.dispatchEvent(new MouseEvent('click', clickOpts));
      await sleep(1200); // wait for AJAX to arrive
      const val1 = readToothNumberFromPanel();

      if (val1 && val1 !== prevNum) {
        // Double-click verification: click the SAME polygon again.
        // If the response was a stale AJAX from a previous polygon, the second click
        // will produce a DIFFERENT value; if it's the correct tooth, it stays the same.
        el.dispatchEvent(new MouseEvent('click', clickOpts));
        await sleep(800);
        const val2 = readToothNumberFromPanel();
        if (val2 === val1) num = val1; // confirmed — two independent reads agree
      }

      console.log('[VetDental] svgIdx', svgIndex, 'imagemapitem:', imagemapItem, '→ tooth', num);
    } else {
      console.log('[VetDental] svgIdx', svgIndex, 'imagemapitem:', imagemapItem, '→ tooth', num, '(fast path)');
    }

    // First match wins — crown (largest area) is processed before root for each tooth.
    // Store an attribute-based selector so the element can be found regardless of DOM order.
    if (num && !map[num]) {
      const childSelector = imagemapItem
        ? `polygon[imagemapitem="${imagemapItem}"]`
        : `${childTag}:nth-of-type(${svgIndex})`;
      map[num] = `${containerSelector} > ${childSelector}`;
    }
  }

  console.log('[VetDental] Discovery complete, map:', map);
  if (Object.keys(map).length === 0) return { error: 'No teeth found — ensure the dental chart is visible and try again' };
  await saveToothMap(map, species);
  return { ok: true, count: Object.keys(map).length };
}

function readToothNumberFromPanel() {
  // Ezyvet shows "Notes For Tooth: NNN (N)" when a tooth polygon is left-clicked.
  // Scope to the active record panel to avoid reading from other patients' panels.
  const pattern = /Notes\s+for\s+(?:Tooth|Mouth)[:\s]+(\d{3})/i;
  const root = getActiveRecordPanel();

  function tryEl(el) {
    if (!el) return null;
    const text = el.textContent || '';
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (isValidToothNumber(num)) return num;
    }
    return null;
  }

  // Search the active panel first
  let result = tryEl(root);
  if (result) return result;

  // Then search iframes within the active panel
  for (const frame of root.querySelectorAll('iframe')) {
    try {
      result = tryEl(frame.contentDocument?.body);
      if (result) return result;
    } catch (_) {}
  }

  return null;
}

// ── Storage ────────────────────────────────────────────────────────────────
function loadToothPattern() {
  return new Promise(resolve =>
    chrome.storage.local.get(['ezyvetToothPattern'], res => resolve(res.ezyvetToothPattern || null))
  );
}

function loadToothMap(species) {
  return new Promise(resolve =>
    chrome.storage.local.get(['ezyvetToothMap'], res => {
      const stored = res.ezyvetToothMap || null;
      if (!stored) return resolve(null);
      // Migrated format: { dog: {...}, cat: {...} }
      if (stored.dog || stored.cat) return resolve(species ? (stored[species] || null) : stored);
      // Legacy flat format — treat as dog map, migrate in place
      const migrated = { dog: stored };
      chrome.storage.local.set({ ezyvetToothMap: migrated });
      return resolve(species === 'cat' ? null : stored);
    })
  );
}

function saveToothMap(map, species) {
  return new Promise(resolve =>
    chrome.storage.local.get(['ezyvetToothMap'], res => {
      const stored = res.ezyvetToothMap || {};
      const base = (stored.dog || stored.cat) ? stored : { dog: stored }; // handle legacy
      base[species] = map;
      chrome.storage.local.set({ ezyvetToothMap: base }, resolve);
    })
  );
}

// ── DOM Inspector Mode ─────────────────────────────────────────────────────
let inspectorActive = false;
let highlightEl = null;

function startInspector(sendResponse) {
  if (inspectorActive) { sendResponse({ ok: true }); return; }
  inspectorActive = true;
  sendResponse({ ok: true });

  const style = document.createElement('style');
  style.id = 'vet-inspector-style';
  style.textContent = `
    .vet-inspector-highlight {
      outline: 3px solid #0EA5A5 !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }
    #vet-inspector-panel {
      position: fixed;
      bottom: 16px;
      right: 16px;
      width: 340px;
      background: #1E293B;
      border: 1px solid #0EA5A5;
      border-radius: 10px;
      padding: 14px;
      z-index: 2147483647;
      font-family: -apple-system, sans-serif;
      font-size: 13px;
      color: #E2E8F0;
      box-shadow: 0 8px 32px rgba(0,0,0,0.7);
    }
    #vet-inspector-panel h4 { margin: 0 0 6px; font-size: 13px; color: #40D6C2; }
    #vet-inspector-panel p  { font-size: 11px; color: #94A3B8; margin: 0 0 8px; line-height: 1.5; }
    #vet-tooth-id-input {
      width: 100%; background: #0F172A; border: 1px solid #334155; border-radius: 4px;
      color: #E2E8F0; padding: 5px 8px; font-size: 12px; margin-bottom: 8px; box-sizing: border-box;
    }
    #vet-inspector-selector {
      background: #0F172A; border: 1px solid #475569; border-radius: 4px;
      padding: 5px 8px; font-size: 10px; font-family: monospace; color: #40D6C2;
      word-break: break-all; margin-bottom: 8px; min-height: 22px;
    }
    #vet-inspector-btns { display: flex; gap: 6px; }
    #vet-inspector-btns button {
      flex: 1; border: none; border-radius: 4px; color: white;
      padding: 7px; font-size: 12px; cursor: pointer; font-weight: 600;
    }
    #vet-btn-save   { background: #0EA5A5; }
    #vet-btn-cancel { background: transparent; border: 1px solid #334155 !important; color: #94A3B8; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'vet-inspector-panel';
  panel.innerHTML = `
    <h4>🦷 Map One Tooth</h4>
    <p>
      Hover over <strong>any tooth</strong> in the Ezyvet chart (e.g. the canine — 104).
      When it highlights, <strong>click it</strong> (or press <strong>Enter</strong>) to lock it — the selector turns green.
      Then type the tooth number and click Save.
    </p>
    <label style="font-size:11px;color:#94A3B8;display:block;margin-bottom:3px">
      Tooth number you are hovering over:
    </label>
    <input type="number" id="vet-tooth-id-input" placeholder="e.g. 104" min="101" max="411">
    <div id="vet-inspector-selector">Hover over a tooth in the chart…</div>
    <div id="vet-inspector-btns">
      <button id="vet-btn-save">💾 Save</button>
      <button id="vet-btn-cancel">Cancel (Esc)</button>
    </div>
  `;
  document.body.appendChild(panel);

  let hoveredSelector = null;
  let lockedSelector = null;
  const selectorDisplay = document.getElementById('vet-inspector-selector');

  function setLocked(selector) {
    lockedSelector = selector;
    selectorDisplay.textContent = '🔒 Locked: ' + selector;
    selectorDisplay.style.color = '#22C55E';
    document.getElementById('vet-tooth-id-input').focus();
  }

  function onMouseMove(e) {
    if (panel.contains(e.target)) return;
    if (lockedSelector) return;
    if (highlightEl && highlightEl !== e.target) {
      highlightEl.classList.remove('vet-inspector-highlight');
    }
    highlightEl = e.target;
    highlightEl.classList.add('vet-inspector-highlight');
    hoveredSelector = getUniqueCSSSelector(e.target);
    selectorDisplay.textContent = hoveredSelector + '  (click or press Enter to lock)';
    selectorDisplay.style.color = '#40D6C2';
  }

  function onPageClick(e) {
    if (panel.contains(e.target)) return;
    if (!hoveredSelector) return;
    setLocked(hoveredSelector);
  }

  panel.addEventListener('mouseenter', () => {
    if (!lockedSelector && hoveredSelector) setLocked(hoveredSelector);
  });

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (lockedSelector) {
        lockedSelector = null;
        selectorDisplay.style.color = '#40D6C2';
        selectorDisplay.textContent = hoveredSelector || 'Hover over a tooth…';
      } else {
        stopInspector();
      }
      return;
    }
    if (e.key === 'Enter' && hoveredSelector && !panel.contains(document.activeElement)) {
      setLocked(hoveredSelector);
    }
  }

  document.getElementById('vet-btn-save').addEventListener('click', () => {
    const toothIdVal = document.getElementById('vet-tooth-id-input').value.trim();
    const selectorToSave = lockedSelector || hoveredSelector;
    if (!selectorToSave) {
      selectorDisplay.textContent = '⚠ Hover over a tooth and click (or press Enter) to lock it first';
      return;
    }
    if (!toothIdVal) {
      const inp = document.getElementById('vet-tooth-id-input');
      inp.focus();
      inp.style.outline = '2px solid #E74C3C';
      return;
    }
    document.getElementById('vet-tooth-id-input').style.outline = '';
    const pattern = { sampleId: parseInt(toothIdVal, 10), sampleSelector: selectorToSave };

    // Clear any stale tooth map so it rebuilds on next push
    chrome.storage.local.remove('ezyvetToothMap', () => {
      chrome.storage.local.set({ ezyvetToothPattern: pattern }, () => {
        chrome.runtime.sendMessage({
          action: 'fromContent',
          payload: { action: 'toothPatternSaved', pattern }
        });
        selectorDisplay.textContent = '✓ Saved! The full map will be built on first push.';
        selectorDisplay.style.color = '#22C55E';
        setTimeout(stopInspector, 1800);
      });
    });
  });

  function stopInspector() {
    inspectorActive = false;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onPageClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (highlightEl) highlightEl.classList.remove('vet-inspector-highlight');
    panel.remove();
    document.getElementById('vet-inspector-style')?.remove();
  }

  document.getElementById('vet-btn-cancel').addEventListener('click', stopInspector);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onPageClick, true);
  document.addEventListener('keydown', onKeyDown, true);
}

// ── Multi-Tooth Manual Inspector ───────────────────────────────────────────
function startMultiToothInspector(species, existingMap, sendResponse) {
  if (inspectorActive) return sendResponse({ error: 'Inspector already active' });
  inspectorActive = true;
  sendResponse({ ok: true });

  const TEETH = {
    dog: [101,102,103,104,105,106,107,108,109,110,
          201,202,203,204,205,206,207,208,209,210,
          301,302,303,304,305,306,307,308,309,310,311,
          401,402,403,404,405,406,407,408,409,410,411],
    cat: [101,102,103,104,106,107,108,109,
          201,202,203,204,206,207,208,209,
          301,302,303,304,307,308,309,
          401,402,403,404,407,408,409],
  };
  const teeth = TEETH[species] || TEETH.dog;
  let map = { ...existingMap };
  let targetToothId = null;
  let lockedSelector = null;
  let highlightEl2 = null;

  // ── Styles ──
  const style = document.createElement('style');
  style.id = 'vet-multi-inspector-style';
  style.textContent = `
    #vet-multi-panel {
      position:fixed;bottom:16px;right:16px;z-index:2147483647;
      width:360px;max-height:480px;background:#1E293B;color:#E2E8F0;
      border:1px solid #334155;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.6);
      font:13px/1.4 system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden;
    }
    #vet-multi-panel h4 {margin:0;padding:10px 14px 8px;font-size:13px;
      border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center}
    #vet-multi-grid {display:flex;flex-wrap:wrap;gap:4px;padding:10px 12px;overflow-y:auto;flex:1}
    .vet-tooth-btn {
      width:40px;height:28px;border-radius:5px;border:1px solid #475569;background:#334155;
      color:#CBD5E1;font-size:11px;cursor:pointer;position:relative;
    }
    .vet-tooth-btn.mapped {background:#14532D;border-color:#22C55E;color:#86EFAC;}
    .vet-tooth-btn.active {background:#1E3A5F;border-color:#60A5FA;color:#BFDBFE;box-shadow:0 0 0 2px #3B82F6;}
    #vet-multi-status {padding:7px 14px;font-size:11px;color:#94A3B8;
      border-top:1px solid #334155;min-height:32px;word-break:break-all;}
    #vet-multi-panel button.done-btn {
      margin:8px 14px 10px;padding:6px;border-radius:6px;border:none;
      background:#374151;color:#E2E8F0;cursor:pointer;font-size:12px;
    }
    .vet-inspector-highlight2 {outline:3px solid #F59E0B!important;outline-offset:2px!important;}
  `;
  document.head.appendChild(style);

  // ── Panel HTML ──
  const panel = document.createElement('div');
  panel.id = 'vet-multi-panel';

  function mappedCount() { return Object.keys(map).length; }

  function renderGrid() {
    const grid = panel.querySelector('#vet-multi-grid');
    grid.innerHTML = '';
    teeth.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'vet-tooth-btn' + (map[t] ? ' mapped' : '') + (t === targetToothId ? ' active' : '');
      btn.textContent = String(t) + (map[t] ? '✓' : '');
      btn.title = map[t] ? `${t} — mapped` : `${t} — click to target`;
      btn.addEventListener('click', (e) => { e.stopPropagation(); armTooth(t); });
      grid.appendChild(btn);
    });
    panel.querySelector('h4 span').textContent = `Mapped ${mappedCount()} / ${teeth.length}`;
  }

  panel.innerHTML = `
    <h4>🦷 Map All Teeth <span>Mapped 0 / ${teeth.length}</span></h4>
    <div id="vet-multi-grid"></div>
    <div id="vet-multi-status">Click a tooth number above to target it, then click its polygon in the Ezyvet chart.</div>
    <button class="done-btn">Done / Close</button>
  `;
  document.body.appendChild(panel);
  renderGrid();

  const statusEl = panel.querySelector('#vet-multi-status');

  function setStatus(msg, color) {
    statusEl.textContent = msg;
    statusEl.style.color = color || '#94A3B8';
  }

  function armTooth(toothId) {
    targetToothId = toothId;
    lockedSelector = null;
    setStatus(`Target: ${toothId} — hover over its polygon then click`, '#60A5FA');
    renderGrid();
  }

  // Auto-arm the first unmapped tooth
  const firstUnmapped = teeth.find(t => !map[t]);
  if (firstUnmapped) armTooth(firstUnmapped);

  function saveCurrent(selector) {
    if (!targetToothId) return;
    map[targetToothId] = selector;
    saveToothMap(map, species);
    try { chrome.runtime.sendMessage({ action: 'fromContent', payload: { action: 'toothMapped', toothId: targetToothId, count: mappedCount(), total: teeth.length } }); } catch (_) {}
    setStatus(`✓ Tooth ${targetToothId} mapped (${mappedCount()}/${teeth.length})`, '#22C55E');

    // Auto-advance to next unmapped tooth
    const idx = teeth.indexOf(targetToothId);
    const next = teeth.slice(idx + 1).find(t => !map[t]) || teeth.find(t => !map[t]);
    if (next && next !== targetToothId) {
      setTimeout(() => armTooth(next), 600);
    } else {
      targetToothId = null;
      renderGrid();
    }
  }

  function onMouseMove(e) {
    if (panel.contains(e.target)) return;
    if (lockedSelector) return;
    if (highlightEl2 && highlightEl2 !== e.target) highlightEl2.classList.remove('vet-inspector-highlight2');
    highlightEl2 = e.target;
    highlightEl2.classList.add('vet-inspector-highlight2');
  }

  function onPageClick(e) {
    if (panel.contains(e.target)) return;
    if (!targetToothId) { setStatus('Click a tooth number first', '#F59E0B'); return; }
    e.preventDefault();
    e.stopPropagation();
    const sel = getUniqueCSSSelector(e.target);
    lockedSelector = sel;
    setStatus(`Locking ${sel} → tooth ${targetToothId}…`, '#A78BFA');
    saveCurrent(sel);
    lockedSelector = null;
    renderGrid();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { stopMultiInspector(); }
  }

  panel.querySelector('.done-btn').addEventListener('click', stopMultiInspector);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onPageClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  function stopMultiInspector() {
    inspectorActive = false;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onPageClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (highlightEl2) highlightEl2.classList.remove('vet-inspector-highlight2');
    panel.remove();
    document.getElementById('vet-multi-inspector-style')?.remove();
  }
}

// ── CSS Selector Generator ─────────────────────────────────────────────────
function getUniqueCSSSelector(el) {
  if (!el || el === document.body) return 'body';
  if (el.id && /^[a-zA-Z]/.test(el.id)) return `#${CSS.escape(el.id)}`;
  if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
  // SVG polygon with imagemapitem — stable, position-independent selector
  if (el.tagName.toLowerCase() === 'polygon' && el.getAttribute('imagemapitem')) {
    const imgItem = el.getAttribute('imagemapitem');
    const parent = el.parentElement;
    const parentSel = (parent?.id && /^[a-zA-Z]/.test(parent.id))
      ? `#${CSS.escape(parent.id)}`
      : getUniqueCSSSelector(parent);
    return `${parentSel} > polygon[imagemapitem="${CSS.escape(imgItem)}"]`;
  }
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-') && attr.value) {
      return `${el.tagName.toLowerCase()}[${attr.name}="${CSS.escape(attr.value)}"]`;
    }
  }
  const path = [];
  let current = el;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id && /^[a-zA-Z]/.test(current.id)) { path.unshift(`#${CSS.escape(current.id)}`); break; }
    const siblings = [...(current.parentElement?.children || [])].filter(s => s.tagName === current.tagName);
    if (siblings.length > 1) selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ');
}

} // end of window.__vetDentalBridgeLoaded guard
