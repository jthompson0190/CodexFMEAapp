const { neon } = require('@neondatabase/serverless');

function getSqlClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured. Set it in Netlify environment variables.');
  }
  return neon(databaseUrl);
}

async function ensureSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS fmeas (
      id TEXT PRIMARY KEY,
      process TEXT NOT NULL,
      team_leader TEXT,
      process_owner TEXT,
      creation_date DATE,
      revision_date DATE,
      status TEXT NOT NULL DEFAULT 'Draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS process_steps (
      id TEXT PRIMARY KEY,
      fmea_id TEXT NOT NULL REFERENCES fmeas(id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL,
      name TEXT,
      step_description TEXT,
      collapsed BOOLEAN NOT NULL DEFAULT FALSE
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS equipments (
      id TEXT PRIMARY KEY,
      process_step_id TEXT NOT NULL REFERENCES process_steps(id) ON DELETE CASCADE,
      description TEXT,
      functional_location TEXT,
      equipment_number TEXT,
      material_number TEXT,
      equipment_class TEXT,
      collapsed BOOLEAN NOT NULL DEFAULT FALSE
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS failure_modes (
      id TEXT PRIMARY KEY,
      equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
      mode TEXT,
      effects TEXT,
      cause TEXT,
      controls TEXT,
      collapsed BOOLEAN NOT NULL DEFAULT FALSE,
      severity INTEGER NOT NULL DEFAULT 1,
      occurrence INTEGER NOT NULL DEFAULT 1,
      detection INTEGER NOT NULL DEFAULT 1
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      failure_mode_id TEXT NOT NULL REFERENCES failure_modes(id) ON DELETE CASCADE,
      text TEXT,
      work_order TEXT,
      responsible TEXT,
      target_date DATE,
      status TEXT NOT NULL DEFAULT 'Not Started'
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS equipment_templates (
      id TEXT PRIMARY KEY,
      equipment_type TEXT,
      class_description TEXT,
      failure_modes JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS app_meta (
      id INTEGER PRIMARY KEY,
      current_page TEXT,
      selected_fmea_id TEXT,
      equipment_search JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

  await sql`ALTER TABLE equipments ADD COLUMN IF NOT EXISTS equipment_class TEXT`;
  await sql`ALTER TABLE equipment_templates ADD COLUMN IF NOT EXISTS failure_modes JSONB NOT NULL DEFAULT '[]'::jsonb`;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  try {
    const sql = getSqlClient();
    await ensureSchema(sql);

    if (event.httpMethod === 'GET') {
      const [fmeas, steps, equipments, failureModes, actions, templates, metaRows] = await Promise.all([
        sql`SELECT * FROM fmeas ORDER BY created_at ASC`,
        sql`SELECT * FROM process_steps ORDER BY step_number ASC`,
        sql`SELECT * FROM equipments`,
        sql`SELECT * FROM failure_modes`,
        sql`SELECT * FROM actions`,
        sql`SELECT * FROM equipment_templates`,
        sql`SELECT * FROM app_meta WHERE id = 1 LIMIT 1`
      ]);

      const actionsByFm = actions.reduce((acc, a) => {
        (acc[a.failure_mode_id] ||= []).push({
          id: a.id,
          text: a.text || '',
          workOrder: a.work_order || '',
          responsible: a.responsible || '',
          targetDate: a.target_date ? String(a.target_date).slice(0, 10) : '',
          status: a.status || 'Not Started'
        });
        return acc;
      }, {});

      const fmByEquipment = failureModes.reduce((acc, fm) => {
        (acc[fm.equipment_id] ||= []).push({
          id: fm.id,
          mode: fm.mode || '',
          effects: fm.effects || '',
          cause: fm.cause || '',
          controls: fm.controls || '',
          collapsed: !!fm.collapsed,
          severity: Number(fm.severity || 1),
          occurrence: Number(fm.occurrence || 1),
          detection: Number(fm.detection || 1),
          actions: actionsByFm[fm.id] || []
        });
        return acc;
      }, {});

      const equipmentByStep = equipments.reduce((acc, eq) => {
        (acc[eq.process_step_id] ||= []).push({
          id: eq.id,
          description: eq.description || '',
          functionalLocation: eq.functional_location || '',
          equipmentNumber: eq.equipment_number || '',
          materialNumber: eq.material_number || '',
          equipmentClass: eq.equipment_class || '',
          collapsed: !!eq.collapsed,
          failureModes: fmByEquipment[eq.id] || []
        });
        return acc;
      }, {});

      const stepsByFmea = steps.reduce((acc, step) => {
        (acc[step.fmea_id] ||= []).push({
          id: step.id,
          stepNumber: Number(step.step_number || 1),
          name: step.name || '',
          stepDescription: step.step_description || '',
          collapsed: !!step.collapsed,
          equipments: equipmentByStep[step.id] || []
        });
        return acc;
      }, {});

      const state = {
        currentPage: metaRows[0]?.current_page || 'dashboard',
        selectedFmeaId: metaRows[0]?.selected_fmea_id || null,
        equipmentSearch: metaRows[0]?.equipment_search || {
          equipmentClass: '',
          description: '',
          functionalLocation: '',
          equipmentNumber: '',
          materialNumber: ''
        },
        templates: templates.map((t) => ({
          id: t.id,
          equipmentType: t.equipment_type || '',
          classDescription: t.class_description || '',
          failureModes: Array.isArray(t.failure_modes) ? t.failure_modes : []
        })),
        fmeas: fmeas.map((f) => ({
          id: f.id,
          process: f.process,
          teamLeader: f.team_leader || '',
          processOwner: f.process_owner || '',
          creationDate: f.creation_date ? String(f.creation_date).slice(0, 10) : '',
          revisionDate: f.revision_date ? String(f.revision_date).slice(0, 10) : '',
          status: f.status || 'Draft',
          processSteps: stepsByFmea[f.id] || []
        }))
      };

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(state)
      };
    }

    if (event.httpMethod === 'PUT') {
      let payload;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch (_error) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ ok: false, error: 'Invalid JSON payload' })
        };
      }

      const fmeas = safeArray(payload.fmeas);
      const templates = safeArray(payload.templates);
      const equipmentSearch = payload.equipmentSearch || {};

      await sql`BEGIN`;
      try {
        await sql`DELETE FROM actions`;
        await sql`DELETE FROM failure_modes`;
        await sql`DELETE FROM equipments`;
        await sql`DELETE FROM process_steps`;
        await sql`DELETE FROM fmeas`;
        await sql`DELETE FROM equipment_templates`;

        for (const f of fmeas) {
          await sql`
            INSERT INTO fmeas (id, process, team_leader, process_owner, creation_date, revision_date, status, updated_at)
            VALUES (${f.id}, ${f.process || ''}, ${f.teamLeader || ''}, ${f.processOwner || ''},
                    ${f.creationDate || null}, ${f.revisionDate || null}, ${f.status || 'Draft'}, NOW())
          `;

          for (const step of safeArray(f.processSteps)) {
            await sql`
              INSERT INTO process_steps (id, fmea_id, step_number, name, step_description, collapsed)
              VALUES (${step.id}, ${f.id}, ${Number(step.stepNumber || 1)}, ${step.name || ''}, ${step.stepDescription || ''}, ${!!step.collapsed})
            `;

            for (const eq of safeArray(step.equipments)) {
              await sql`
                INSERT INTO equipments (id, process_step_id, description, functional_location, equipment_number, material_number, equipment_class, collapsed)
                VALUES (${eq.id}, ${step.id}, ${eq.description || ''}, ${eq.functionalLocation || ''}, ${eq.equipmentNumber || ''}, ${eq.materialNumber || ''}, ${eq.equipmentClass || ''}, ${!!eq.collapsed})
              `;

              for (const fm of safeArray(eq.failureModes)) {
                await sql`
                  INSERT INTO failure_modes (id, equipment_id, mode, effects, cause, controls, collapsed, severity, occurrence, detection)
                  VALUES (${fm.id}, ${eq.id}, ${fm.mode || ''}, ${fm.effects || ''}, ${fm.cause || ''}, ${fm.controls || ''},
                          ${!!fm.collapsed}, ${Number(fm.severity || 1)}, ${Number(fm.occurrence || 1)}, ${Number(fm.detection || 1)})
                `;

                for (const action of safeArray(fm.actions)) {
                  await sql`
                    INSERT INTO actions (id, failure_mode_id, text, work_order, responsible, target_date, status)
                    VALUES (${action.id}, ${fm.id}, ${action.text || ''}, ${action.workOrder || ''}, ${action.responsible || ''},
                            ${action.targetDate || null}, ${action.status || 'Not Started'})
                  `;
                }
              }
            }
          }
        }

        for (const t of templates) {
          await sql`
            INSERT INTO equipment_templates (id, equipment_type, class_description, failure_modes)
            VALUES (${t.id}, ${t.equipmentType || ''}, ${t.classDescription || ''}, ${JSON.stringify(t.failureModes || [])}::jsonb)
          `;
        }

        await sql`
          INSERT INTO app_meta (id, current_page, selected_fmea_id, equipment_search, updated_at)
          VALUES (1, ${payload.currentPage || 'dashboard'}, ${payload.selectedFmeaId || null}, ${JSON.stringify(equipmentSearch)}::jsonb, NOW())
          ON CONFLICT (id)
          DO UPDATE SET
            current_page = EXCLUDED.current_page,
            selected_fmea_id = EXCLUDED.selected_fmea_id,
            equipment_search = EXCLUDED.equipment_search,
            updated_at = NOW()
        `;

        await sql`COMMIT`;
      } catch (error) {
        await sql`ROLLBACK`;
        throw error;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, fmeaCount: fmeas.length })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: 'Method not allowed' })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: error.message || 'Internal server error' })
    };
  }
};
