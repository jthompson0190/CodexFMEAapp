const { neon } = require('@neondatabase/serverless');

const STATE_ROW_ID = 1;

function getSqlClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured. Set it in Netlify environment variables.');
  }
  return neon(databaseUrl);
}

async function ensureSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY,
      state_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
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
      const rows = await sql`
        SELECT state_json
        FROM app_state
        WHERE id = ${STATE_ROW_ID}
        LIMIT 1
      `;

      if (!rows.length) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({})
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(rows[0].state_json || {})
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

      await sql`
        INSERT INTO app_state (id, state_json, updated_at)
        VALUES (${STATE_ROW_ID}, ${JSON.stringify(payload)}::jsonb, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          state_json = EXCLUDED.state_json,
          updated_at = NOW()
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true })
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
