const state = {
  currentPage: 'dashboard',
  selectedFmeaId: null,
  fmeas: [],
  templates: [],
  equipmentSearch: {
    equipmentClass: '',
    description: '',
    functionalLocation: '',
    equipmentNumber: '',
    materialNumber: ''
  }
};

const pages = {
  dashboard: document.getElementById('dashboardPage'),
  fmea: document.getElementById('fmeaPage'),
  actions: document.getElementById('actionsPage'),
  templates: document.getElementById('templatesPage'),
  equipment: document.getElementById('equipmentPage')
};

const API_STATE_ENDPOINT = '/api/state';

function saveState() {
  localStorage.setItem('fmeaState', JSON.stringify(state));
  fetch(API_STATE_ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  }).catch(() => {
    // Keep localStorage as offline fallback if backend is unavailable.
  });
}

async function loadState() {
  let loaded = false;
  try {
    const response = await fetch(API_STATE_ENDPOINT);
    if (response.ok) {
      const remoteState = await response.json();
      if (remoteState && typeof remoteState === 'object' && Object.keys(remoteState).length) {
        Object.assign(state, remoteState);
        loaded = true;
      }
    }
  } catch (_error) {
    // Fallback to localStorage for local/non-Netlify execution.
  }

  if (!loaded) {
    const raw = localStorage.getItem('fmeaState');
    if (raw) {
      Object.assign(state, JSON.parse(raw));
    }
  }
  migrateState();
}

function migrateState() {
  state.equipmentSearch = {
    equipmentClass: state.equipmentSearch?.equipmentClass || '',
    description: state.equipmentSearch?.description || '',
    functionalLocation: state.equipmentSearch?.functionalLocation || '',
    equipmentNumber: state.equipmentSearch?.equipmentNumber || '',
    materialNumber: state.equipmentSearch?.materialNumber || ''
  };

  state.fmeas = (state.fmeas || []).map((fmea) => ({
    ...fmea,
    status: ['Draft', 'Complete'].includes(fmea.status) ? fmea.status : 'Draft',
    processSteps: (fmea.processSteps || []).map((step, i) => {
      let equipments = step.equipments;
      if (!Array.isArray(equipments)) {
        const legacyFms = Array.isArray(step.failureModes) ? step.failureModes : [];
        equipments = [
          {
            id: crypto.randomUUID(),
            description: '',
            functionalLocation: '',
            equipmentNumber: '',
            materialNumber: '',
            collapsed: false,
            failureModes: legacyFms
          }
        ];
      }
      return {
        id: step.id || crypto.randomUUID(),
        stepNumber: i + 1,
        name: step.name || '',
        stepDescription: step.stepDescription || '',
        collapsed: Boolean(step.collapsed),
        equipments: equipments.map((eq) => ({
          id: eq.id || crypto.randomUUID(),
          description: eq.description || '',
          functionalLocation: eq.functionalLocation || '',
          equipmentNumber: eq.equipmentNumber || '',
          materialNumber: eq.materialNumber || '',
          collapsed: Boolean(eq.collapsed),
          failureModes: (eq.failureModes || []).map((fm) => ({
            id: fm.id || crypto.randomUUID(),
            equipmentClass: fm.equipmentClass || eq.className || '',
            mode: fm.mode || '',
            effects: fm.effects || '',
            cause: fm.cause || '',
            controls: fm.controls || '',
            collapsed: Boolean(fm.collapsed),
            severity: Number(fm.severity || 1),
            occurrence: Number(fm.occurrence || 1),
            detection: Number(fm.detection || 1),
            actions: (fm.actions || []).map((action) => ({
              id: action.id || crypto.randomUUID(),
              text: action.text || '',
              workOrder: action.workOrder || '',
              responsible: action.responsible || '',
              targetDate: action.targetDate || today(),
              status: normalizeActionStatus(action.status)
            }))
          }))
        }))
      };
    })
  }));

  state.templates = (state.templates || []).map((t) => ({
    id: t.id || crypto.randomUUID(),
    equipmentType: (t.equipmentType || '').trim(),
    classDescription: t.classDescription || '',
    defaultFailureModes: t.defaultFailureModes || '',
    defaultCauses: t.defaultCauses || '',
    defaultControls: t.defaultControls || ''
  }));
}

function actionStatuses() {
  return ['Not Started', 'In Progress', 'Complete', 'Cancelled'];
}

function normalizeActionStatus(status) {
  if (status === 'Open') return 'Not Started';
  if (status === 'In Progress') return 'In Progress';
  if (status === 'Complete') return 'Complete';
  if (status === 'Cancelled') return 'Cancelled';
  return 'Not Started';
}

function isOpenAction(action) {
  return ['Not Started', 'In Progress'].includes(normalizeActionStatus(action.status));
}

function isPastDueAction(action) {
  return isOpenAction(action) && action.targetDate < today();
}

function actionStatusClass(action) {
  if (isPastDueAction(action)) return 'action-past-due';
  const status = normalizeActionStatus(action.status);
  if (status === 'Not Started') return 'action-not-started';
  if (status === 'In Progress') return 'action-in-progress';
  if (status === 'Complete') return 'action-complete';
  if (status === 'Cancelled') return 'action-cancelled';
  return '';
}

function getEquipmentClassOptions() {
  return [...new Set(state.templates.map((t) => t.equipmentType).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function setPage(name) {
  state.currentPage = name;
  Object.entries(pages).forEach(([k, el]) => el.classList.toggle('active', k === name));
  document.getElementById('pageTitle').textContent = name === 'fmea' ? 'FMEA Details' : name[0].toUpperCase() + name.slice(1);
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.page === name));
}

function getSelectedFmea() {
  if (!state.selectedFmeaId && state.fmeas.length) state.selectedFmeaId = state.fmeas[0].id;
  return state.fmeas.find((f) => f.id === state.selectedFmeaId);
}

function isSelectedFmeaReadOnly() {
  return getSelectedFmea()?.status === 'Complete';
}

function disabledAttr() {
  return isSelectedFmeaReadOnly() ? 'disabled' : '';
}

function rpn(fm) {
  return Number(fm.severity) * Number(fm.occurrence) * Number(fm.detection);
}

function renderDashboard() {
  const body = document.getElementById('fmeaTableBody');
  body.innerHTML = state.fmeas
    .map(
      (f) => `<tr>
      <td><button class="link-btn" data-open-fmea="${f.id}">${f.process}</button></td>
      <td>${f.teamLeader}</td><td>${f.processOwner}</td><td>${f.revisionDate}</td><td>${f.status}</td>
    </tr>`
    )
    .join('');

  const all = flattenActions();
  document.getElementById('kpiCards').innerHTML = `
    <article class="kpi"><h4>Total FMEAs</h4><p>${state.fmeas.length}</p></article>
    <article class="kpi"><h4>Open Actions</h4><p>${all.filter((x) => isOpenAction(x.action)).length}</p></article>
    <article class="kpi"><h4>Past Due</h4><p>${all.filter((x) => isPastDueAction(x.action)).length}</p></article>
    <article class="kpi"><h4>Complete FMEAs</h4><p>${state.fmeas.filter((f) => f.status === 'Complete').length}</p></article>
  `;
}

function renderFmeaForm() {
  const f = getSelectedFmea();
  if (!f) return;
  const ro = isSelectedFmeaReadOnly() ? 'data-readonly="true"' : '';
  const form = document.getElementById('fmeaForm');
  form.innerHTML = [
    field('process', 'Process', f.process),
    field('teamLeader', 'Team Leader', f.teamLeader),
    field('processOwner', 'Process Owner', f.processOwner),
    field('creationDate', 'Creation Date', f.creationDate, 'date'),
    field('revisionDate', 'Revision Date', f.revisionDate, 'date'),
    selectField('status', 'FMEA Status', ['Draft', 'Complete'], f.status)
  ].join('');
  form.setAttribute('data-readonly', ro);
  form.querySelectorAll('input,select').forEach((el) => {
    if (f.status === 'Complete' && el.name !== 'status') el.disabled = true;
    el.addEventListener('change', () => {
      f[el.name] = el.value;
      saveState();
      renderAll();
    });
  });
}

function renderProcessSteps() {
  const fmea = getSelectedFmea();
  const wrap = document.getElementById('processSteps');
  wrap.innerHTML = '';
  if (!fmea) return;
  const isRO = isSelectedFmeaReadOnly();

  fmea.processSteps.forEach((step, i) => {
    step.stepNumber = i + 1;
    const card = document.createElement('article');
    card.className = 'step-card';
    card.draggable = !isRO;
    card.dataset.stepId = step.id;
    card.innerHTML = `
      <details class="collapsible" ${step.collapsed ? '' : 'open'}>
        <summary class="step-head"><strong><span class="drag-handle">↕</span> Process Step ${step.stepNumber} - ${step.name || 'Unnamed Step'}</strong></summary>
        <div class="step-content">
          <div class="step-actions">
            <label>Step Name <input data-step-field="name" value="${step.name || ''}" ${disabledAttr()} /></label>
            <label>Step Description <textarea rows="3" data-step-field="stepDescription" ${disabledAttr()}>${step.stepDescription || ''}</textarea></label>
            <div class="inline-actions">
              <button class="secondary-btn" data-add-equipment="${step.id}" ${disabledAttr()}>+ Add Equipment</button>
              <button class="danger-btn" data-remove-step="${step.id}" ${disabledAttr()}>Remove</button>
            </div>
          </div>
          <div class="equipment-wrap">${(step.equipments || []).map((eq) => equipmentHtml(step.id, eq)).join('')}</div>
        </div>
      </details>
    `;
    wireStepInteractions(card, fmea, step);
    wrap.appendChild(card);
  });

  if (!isRO) enableStepDnD(wrap, fmea);
}

function equipmentHtml(stepId, eq) {
  return `
    <details class="equipment-card" data-eq-id="${eq.id}" ${eq.collapsed ? '' : 'open'}>
      <summary class="equipment-summary"><strong>Equipment: ${eq.equipmentNumber || eq.description || 'Unnamed Equipment'}</strong></summary>
      <div class="equipment-content">
        <div class="card-header"><span>Equipment Details</span><button class="danger-btn" data-remove-equipment="${stepId}|${eq.id}" ${disabledAttr()}>Remove Equipment</button></div>
        <div class="equipment-details-grid">
          <label>Description <input data-eq-field="description" value="${eq.description || ''}" ${disabledAttr()} /></label>
          <label>Functional Location <input data-eq-field="functionalLocation" value="${eq.functionalLocation || ''}" ${disabledAttr()} /></label>
          <label>Equipment Number <input data-eq-field="equipmentNumber" value="${eq.equipmentNumber || ''}" ${disabledAttr()} /></label>
          <label>Material Number <input data-eq-field="materialNumber" value="${eq.materialNumber || ''}" ${disabledAttr()} /></label>
        </div>
        <label>Apply Equipment Class Template
          <select data-template-select="${eq.id}" ${disabledAttr()}>
            <option value="">Select template...</option>
            ${state.templates.map((t) => `<option value="${t.id}">${t.equipmentType || 'Unnamed Template'}</option>`).join('')}
          </select>
        </label>
        <div class="inline-actions">
          <button class="secondary-btn" data-apply-template="${stepId}|${eq.id}" ${disabledAttr()}>Add Template Failure Modes</button>
          <button class="secondary-btn" data-add-fm="${stepId}|${eq.id}" ${disabledAttr()}>+ Failure Mode</button>
          <button class="secondary-btn" data-create-template-from-equipment="${stepId}|${eq.id}" ${disabledAttr()}>Create Template from Equipment</button>
        </div>
        <h4>Failure Modes</h4>
        <div>${eq.failureModes.map((fm) => failureModeHtml(stepId, eq.id, fm)).join('')}</div>
      </div>
    </details>
  `;
}

function failureModeHtml(stepId, equipmentId, fm) {
  const openActions = (fm.actions || []).filter((a) => isOpenAction(a)).length;
  return `
    <details class="failure-mode" data-fm-id="${fm.id}" ${fm.collapsed ? '' : 'open'}>
      <summary class="failure-mode-summary">
        <strong>${fm.mode || 'Unnamed Failure Mode'}</strong>
        <span class="summary-kpis">RPN: <strong>${rpn(fm)}</strong> | Open Actions: <strong>${openActions}</strong></span>
      </summary>
      <div class="failure-mode-content">
        <label>Equipment Class
          <select data-fm-field="equipmentClass" ${disabledAttr()}>
            <option value="">Select class...</option>
            ${getEquipmentClassOptions().map((c) => `<option ${fm.equipmentClass === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </label>
        <div class="failure-mode-fields">
          <label>Failure Mode <textarea rows="3" data-fm-field="mode" ${disabledAttr()}>${fm.mode || ''}</textarea></label>
          <label>Effects of Failure Mode <textarea rows="3" data-fm-field="effects" ${disabledAttr()}>${fm.effects || ''}</textarea></label>
          <label>Potential Cause of Failure <textarea rows="3" data-fm-field="cause" ${disabledAttr()}>${fm.cause || ''}</textarea></label>
          <label>Current Controls <textarea rows="3" data-fm-field="controls" ${disabledAttr()}>${fm.controls || ''}</textarea></label>
        </div>
        <div class="form-grid">
          <label>Severity <input type="number" min="1" max="10" data-fm-field="severity" value="${fm.severity || 1}" ${disabledAttr()} /></label>
          <label>Occurrence <input type="number" min="1" max="10" data-fm-field="occurrence" value="${fm.occurrence || 1}" ${disabledAttr()} /></label>
          <label>Detection <input type="number" min="1" max="10" data-fm-field="detection" value="${fm.detection || 1}" ${disabledAttr()} /></label>
          <label>RPN Score <input disabled value="${rpn(fm)}" /></label>
        </div>
        <div class="inline-actions">
          <button class="secondary-btn" data-add-action="${stepId}|${equipmentId}|${fm.id}" ${disabledAttr()}>+ Recommended Action</button>
          <button class="danger-btn" data-remove-fm="${stepId}|${equipmentId}|${fm.id}" ${disabledAttr()}>Remove Failure Mode</button>
        </div>
        <div class="actions-section">
          ${fm.actions
            .map(
              (a) => `<div class="form-grid action-item ${actionStatusClass(a)}">
                <label>Action <input data-action-field="text" data-action-id="${a.id}" value="${a.text}" ${disabledAttr()} /></label>
                <label>Work Order <input data-action-field="workOrder" data-action-id="${a.id}" value="${a.workOrder || ''}" ${disabledAttr()} /></label>
                <label>Responsible <input data-action-field="responsible" data-action-id="${a.id}" value="${a.responsible}" ${disabledAttr()} /></label>
                <label>Target Date <input type="date" data-action-field="targetDate" data-action-id="${a.id}" value="${a.targetDate}" ${disabledAttr()} /></label>
                <label>Status
                  <select data-action-field="status" data-action-id="${a.id}" ${disabledAttr()}>
                    ${actionStatuses().map((s) => `<option ${a.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                  </select>
                </label>
              </div>`
            )
            .join('')}
        </div>
      </div>
    </details>
  `;
}

function wireStepInteractions(card, fmea, step) {
  const readOnly = isSelectedFmeaReadOnly();
  card.querySelector('[data-step-field="name"]').addEventListener('change', (e) => {
    step.name = e.target.value;
    saveState();
    renderAll();
  });
  card.querySelector('[data-step-field="stepDescription"]').addEventListener('change', (e) => {
    step.stepDescription = e.target.value;
    saveState();
  });
  card.querySelector('details.collapsible').addEventListener('toggle', (e) => {
    step.collapsed = !e.currentTarget.open;
    saveState();
  });
  if (readOnly) return;

  card.querySelector('[data-remove-step]').addEventListener('click', () => {
    fmea.processSteps = fmea.processSteps.filter((s) => s.id !== step.id);
    saveState();
    renderAll();
  });
  card.querySelector('[data-add-equipment]').addEventListener('click', () => {
    step.equipments.push({
      id: crypto.randomUUID(),
      description: '',
      functionalLocation: '',
      equipmentNumber: '',
      materialNumber: '',
      collapsed: false,
      failureModes: []
    });
    saveState();
    renderAll();
  });

  card.querySelectorAll('[data-remove-equipment]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const equipmentId = btn.dataset.removeEquipment.split('|')[1];
      step.equipments = step.equipments.filter((eq) => eq.id !== equipmentId);
      saveState();
      renderAll();
    });
  });

  card.querySelectorAll('[data-eq-id]').forEach((eqEl) => {
    const equipment = step.equipments.find((x) => x.id === eqEl.dataset.eqId);
    eqEl.addEventListener('toggle', () => {
      equipment.collapsed = !eqEl.open;
      saveState();
    });
    eqEl.querySelectorAll('[data-eq-field]').forEach((input) => {
      input.addEventListener('change', (e) => {
        equipment[e.target.dataset.eqField] = e.target.value;
        saveState();
      });
    });
    eqEl.querySelector('[data-apply-template]')?.addEventListener('click', (e) => {
      const equipmentId = e.target.dataset.applyTemplate.split('|')[1];
      const select = eqEl.querySelector(`[data-template-select="${equipmentId}"]`);
      const template = state.templates.find((t) => t.id === select.value);
      if (!template) return;
      const modes = splitSemicolon(template.defaultFailureModes);
      const causes = splitSemicolon(template.defaultCauses);
      const controls = splitSemicolon(template.defaultControls);
      const maxCount = Math.max(modes.length, causes.length, controls.length, 1);
      for (let i = 0; i < maxCount; i++) {
        equipment.failureModes.push({
          id: crypto.randomUUID(),
          equipmentClass: template.equipmentType,
          mode: modes[i] || '',
          effects: '',
          cause: causes[i] || '',
          controls: controls[i] || '',
          collapsed: false,
          severity: 1,
          occurrence: 1,
          detection: 1,
          actions: []
        });
      }
      saveState();
      renderAll();
    });
    eqEl.querySelector('[data-create-template-from-equipment]')?.addEventListener('click', () => {
      createTemplateFromEquipment(equipment);
    });
    eqEl.querySelector('[data-add-fm]')?.addEventListener('click', (e) => {
      const equipmentId = e.target.dataset.addFm.split('|')[1];
      const target = step.equipments.find((x) => x.id === equipmentId);
      target.failureModes.push({
        id: crypto.randomUUID(),
        equipmentClass: '',
        mode: '',
        effects: '',
        cause: '',
        controls: '',
        collapsed: false,
        severity: 1,
        occurrence: 1,
        detection: 1,
        actions: []
      });
      saveState();
      renderAll();
    });

    eqEl.querySelectorAll('[data-fm-id]').forEach((fmEl) => {
      const fm = equipment.failureModes.find((x) => x.id === fmEl.dataset.fmId);
      fmEl.addEventListener('toggle', () => {
        fm.collapsed = !fmEl.open;
        saveState();
      });
      fmEl.querySelectorAll('[data-fm-field]').forEach((input) => {
        input.addEventListener('change', (e) => {
          fm[e.target.dataset.fmField] = ['severity', 'occurrence', 'detection'].includes(e.target.dataset.fmField)
            ? Number(e.target.value)
            : e.target.value;
          saveState();
          renderAll();
        });
      });
      fmEl.querySelector('[data-add-action]')?.addEventListener('click', () => {
        fm.actions.push({
          id: crypto.randomUUID(),
          text: '',
          workOrder: '',
          responsible: '',
          targetDate: today(),
          status: 'Not Started'
        });
        saveState();
        renderAll();
      });
      fmEl.querySelector('[data-remove-fm]')?.addEventListener('click', () => {
        const confirmed = window.confirm('Are you sure you want to delete this failure mode?');
        if (!confirmed) return;
        equipment.failureModes = equipment.failureModes.filter((x) => x.id !== fm.id);
        saveState();
        renderAll();
      });
      fmEl.querySelectorAll('[data-action-field]').forEach((el) => {
        el.addEventListener('change', (e) => {
          const action = fm.actions.find((a) => a.id === e.target.dataset.actionId);
          action[e.target.dataset.actionField] = e.target.value;
          action.status = normalizeActionStatus(action.status);
          saveState();
          renderAll();
        });
      });
    });
  });
}

function enableStepDnD(container, fmea) {
  let dragged = null;
  container.querySelectorAll('.step-card').forEach((card) => {
    card.addEventListener('dragstart', () => {
      dragged = card.dataset.stepId;
    });
    card.addEventListener('dragover', (e) => e.preventDefault());
    card.addEventListener('drop', () => {
      if (!dragged || dragged === card.dataset.stepId) return;
      const from = fmea.processSteps.findIndex((s) => s.id === dragged);
      const to = fmea.processSteps.findIndex((s) => s.id === card.dataset.stepId);
      const [moved] = fmea.processSteps.splice(from, 1);
      fmea.processSteps.splice(to, 0, moved);
      fmea.processSteps.forEach((s, i) => (s.stepNumber = i + 1));
      saveState();
      renderAll();
    });
  });
}

function flattenActions() {
  return state.fmeas.flatMap((fmea) =>
    fmea.processSteps.flatMap((step) =>
      step.equipments.flatMap((equipment) =>
        equipment.failureModes.flatMap((fm) => fm.actions.map((action) => ({
          fmea,
          step,
          equipment,
          fm,
          action,
          readOnly: fmea.status === 'Complete'
        })))
      )
    )
  );
}

function renderActions() {
  const rows = flattenActions();
  document.getElementById('actionsTableBody').innerHTML = rows
    .map(
      ({ fmea, equipment, fm, action, readOnly }) => `
      <tr class="${actionStatusClass(action)}">
        <td><input data-table-action="text" data-action-id="${action.id}" value="${action.text}" ${readOnly ? 'disabled' : ''} /></td>
        <td><input data-table-action="workOrder" data-action-id="${action.id}" value="${action.workOrder || ''}" ${readOnly ? 'disabled' : ''} /></td>
        <td><input data-table-action="responsible" data-action-id="${action.id}" value="${action.responsible}" ${readOnly ? 'disabled' : ''} /></td>
        <td>${fmea.processOwner}</td>
        <td><input type="date" data-table-action="targetDate" data-action-id="${action.id}" value="${action.targetDate}" ${readOnly ? 'disabled' : ''} /></td>
        <td><select data-table-action="status" data-action-id="${action.id}" ${readOnly ? 'disabled' : ''}>${actionStatuses().map((s) => `<option ${action.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td>${fm.equipmentClass || 'Unclassified'}: ${fm.mode || 'Unnamed Failure Mode'}</td>
      </tr>`
    )
    .join('');

  document.querySelectorAll('[data-table-action]').forEach((el) => {
    el.addEventListener('change', (e) => {
      for (const r of rows) {
        if (r.action.id === e.target.dataset.actionId && !r.readOnly) {
          r.action[e.target.dataset.tableAction] = e.target.value;
          r.action.status = normalizeActionStatus(r.action.status);
        }
      }
      saveState();
      renderAll();
    });
  });

  const byResponsible = rows.reduce((acc, r) => {
    const k = r.action.responsible || 'Unassigned';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const byOwner = rows.reduce((acc, r) => {
    const k = r.fmea.processOwner || 'Unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  document.getElementById('actionKpiCards').innerHTML = `
    <article class="kpi"><h4>Responsible Parties</h4><p>${Object.keys(byResponsible).length}</p></article>
    <article class="kpi"><h4>Process Owners</h4><p>${Object.keys(byOwner).length}</p></article>
    <article class="kpi"><h4>Completed Actions</h4><p>${rows.filter((r) => r.action.status === 'Complete').length}</p></article>
    <article class="kpi"><h4>Past Due Items</h4><p>${rows.filter((r) => isPastDueAction(r.action)).length}</p></article>
  `;
}

function flattenEquipment() {
  return state.fmeas.flatMap((fmea) =>
    fmea.processSteps.flatMap((step) =>
      step.equipments.map((eq) => ({
        fmea,
        step,
        equipment: eq,
        equipmentClasses: [...new Set(eq.failureModes.map((fm) => fm.equipmentClass).filter(Boolean))]
      }))
    )
  );
}

function renderEquipmentPage() {
  const items = flattenEquipment().filter((x) => {
    const classText = x.equipmentClasses.join(' ').toLowerCase();
    return (
      classText.includes(state.equipmentSearch.equipmentClass.toLowerCase()) &&
      (x.equipment.description || '').toLowerCase().includes(state.equipmentSearch.description.toLowerCase()) &&
      (x.equipment.functionalLocation || '').toLowerCase().includes(state.equipmentSearch.functionalLocation.toLowerCase()) &&
      (x.equipment.equipmentNumber || '').toLowerCase().includes(state.equipmentSearch.equipmentNumber.toLowerCase()) &&
      (x.equipment.materialNumber || '').toLowerCase().includes(state.equipmentSearch.materialNumber.toLowerCase())
    );
  });

  document.getElementById('equipmentSearch').innerHTML = `
    <label>Equipment Class <input data-eq-search="equipmentClass" value="${state.equipmentSearch.equipmentClass}" /></label>
    <label>Description <input data-eq-search="description" value="${state.equipmentSearch.description}" /></label>
    <label>Functional Location <input data-eq-search="functionalLocation" value="${state.equipmentSearch.functionalLocation}" /></label>
    <label>Equipment Number <input data-eq-search="equipmentNumber" value="${state.equipmentSearch.equipmentNumber}" /></label>
    <label>Material Number <input data-eq-search="materialNumber" value="${state.equipmentSearch.materialNumber}" /></label>
  `;

  document.getElementById('equipmentTableBody').innerHTML = items
    .map(
      ({ fmea, step, equipment, equipmentClasses }) => `<tr>
      <td>${equipmentClasses.join(', ') || 'Unclassified'}</td>
      <td>${equipment.description || ''}</td>
      <td>${equipment.functionalLocation || ''}</td>
      <td>${equipment.equipmentNumber || ''}</td>
      <td>${equipment.materialNumber || ''}</td>
      <td>${fmea.process}</td>
      <td>${step.stepNumber}</td>
    </tr>`
    )
    .join('');

  document.querySelectorAll('[data-eq-search]').forEach((el) => {
    el.addEventListener('input', (e) => {
      state.equipmentSearch[e.target.dataset.eqSearch] = e.target.value;
      renderEquipmentPage();
      saveState();
    });
  });
}

function renderTemplates() {
  const list = document.getElementById('templateList');
  list.innerHTML = state.templates
    .map(
      (t) => `<article class="template-item">
      <label>Equipment Class <input data-template-field="equipmentType" data-template-id="${t.id}" value="${t.equipmentType}" /></label>
      <label>Class Description <input data-template-field="classDescription" data-template-id="${t.id}" value="${t.classDescription}" /></label>
      <label>Default Failure Modes (semicolon separated)<textarea data-template-field="defaultFailureModes" data-template-id="${t.id}">${t.defaultFailureModes}</textarea></label>
      <label>Default Causes of Failure (semicolon separated)<textarea data-template-field="defaultCauses" data-template-id="${t.id}">${t.defaultCauses}</textarea></label>
      <label>Default Controls (semicolon separated)<textarea data-template-field="defaultControls" data-template-id="${t.id}">${t.defaultControls}</textarea></label>
    </article>`
    )
    .join('');
  document.querySelectorAll('[data-template-field]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const t = state.templates.find((x) => x.id === e.target.dataset.templateId);
      t[e.target.dataset.templateField] = e.target.value;
      saveState();
      renderAll();
    });
  });
}

function field(name, labelText, value, type = 'text') {
  return `<label>${labelText}<input name="${name}" type="${type}" value="${value || ''}" /></label>`;
}
function selectField(name, labelText, options, current) {
  return `<label>${labelText}<select name="${name}">${options.map((o) => `<option ${o === current ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
}
function splitSemicolon(value) {
  return String(value || '')
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
}

function createTemplateFromEquipment(equipment) {
  if (!equipment.failureModes?.length) {
    window.alert('Cannot create template: this equipment has no failure modes.');
    return;
  }
  const suggestedName = equipment.failureModes.find((fm) => fm.equipmentClass)?.equipmentClass || '';
  const equipmentType = window.prompt('Enter Equipment Class name for the new template:', suggestedName);
  if (!equipmentType || !equipmentType.trim()) return;

  state.templates.push({
    id: crypto.randomUUID(),
    equipmentType: equipmentType.trim(),
    classDescription: equipment.description || '',
    defaultFailureModes: equipment.failureModes.map((fm) => fm.mode || '').filter(Boolean).join(';'),
    defaultCauses: equipment.failureModes.map((fm) => fm.cause || '').filter(Boolean).join(';'),
    defaultControls: equipment.failureModes.map((fm) => fm.controls || '').filter(Boolean).join(';')
  });
  saveState();
  renderAll();
  window.alert('Template created from equipment. You can review it on the Equipment Templates page.');
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function quote(v) {
  return `"${String(v || '').replaceAll('"', '""')}"`;
}

function renderAll() {
  renderDashboard();
  renderFmeaForm();
  renderProcessSteps();
  renderActions();
  renderTemplates();
  renderEquipmentPage();
}

document.querySelectorAll('.nav-btn').forEach((btn) => btn.addEventListener('click', () => setPage(btn.dataset.page)));
document.getElementById('backToDashboardBtn').addEventListener('click', () => setPage('dashboard'));

document.getElementById('addStepBtn').addEventListener('click', () => {
  const f = getSelectedFmea();
  if (!f || f.status === 'Complete') return;
  f.processSteps.push({ id: crypto.randomUUID(), stepNumber: f.processSteps.length + 1, name: '', stepDescription: '', collapsed: false, equipments: [] });
  saveState();
  renderAll();
});

document.getElementById('topCreateBtn').addEventListener('click', () => document.getElementById('fmeaDialog').showModal());
document.getElementById('menuCreateBtn').addEventListener('click', () => document.getElementById('fmeaDialog').showModal());
document.getElementById('cancelCreateBtn').addEventListener('click', () => document.getElementById('fmeaDialog').close());

document.getElementById('newFmeaForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  state.fmeas.push({ id: crypto.randomUUID(), ...data, processSteps: [] });
  state.selectedFmeaId = state.fmeas[state.fmeas.length - 1].id;
  saveState();
  document.getElementById('fmeaDialog').close();
  setPage('fmea');
  renderAll();
});

document.body.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open-fmea]');
  if (open) {
    state.selectedFmeaId = open.dataset.openFmea;
    setPage('fmea');
    renderAll();
  }
});

document.getElementById('addTemplateBtn').addEventListener('click', () => {
  state.templates.push({ id: crypto.randomUUID(), equipmentType: '', classDescription: '', defaultFailureModes: '', defaultCauses: '', defaultControls: '' });
  saveState();
  renderAll();
});

document.getElementById('pdfBtn').addEventListener('click', () => window.print());
document.getElementById('excelBtn').addEventListener('click', () => {
  const rows = flattenActions();
  const csv = [
    ['Process', 'Step', 'Equipment Description', 'Equipment Number', 'Equipment Class', 'Failure Mode', 'Action', 'Work Order', 'Responsible', 'Target Date', 'Status'].join(','),
    ...rows.map(({ fmea, step, equipment, fm, action }) =>
      [
        quote(fmea.process),
        step.stepNumber,
        quote(equipment.description),
        quote(equipment.equipmentNumber),
        quote(fm.equipmentClass),
        quote(fm.mode),
        quote(action.text),
        quote(action.workOrder),
        quote(action.responsible),
        action.targetDate,
        action.status
      ].join(',')
    )
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fmea-actions-export.csv';
  a.click();
  URL.revokeObjectURL(url);
});

const sideMenu = document.getElementById('sideMenu');
const overlay = document.getElementById('menuOverlay');
document.getElementById('openMenuBtn').addEventListener('click', () => {
  sideMenu.classList.add('open');
  overlay.classList.add('open');
});
function closeMenu() {
  sideMenu.classList.remove('open');
  overlay.classList.remove('open');
}
document.getElementById('closeMenuBtn').addEventListener('click', closeMenu);
overlay.addEventListener('click', closeMenu);
document.querySelectorAll('.nav-btn').forEach((btn) => btn.addEventListener('click', closeMenu));

async function initializeApp() {
  await loadState();
  setPage(state.currentPage);
  renderAll();
}

initializeApp();
