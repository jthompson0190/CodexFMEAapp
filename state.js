const { getStore } = require('@netlify/blobs');

const store = getStore('fmea-app');
const STATE_KEY = 'state';

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  if (event.httpMethod === 'GET') {
    const value = await store.get(STATE_KEY);
    if (!value) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({})
      };
    }

    return {
      statusCode: 200,
      headers,
      body: value
    };
  }

  if (event.httpMethod === 'PUT') {
    try {
      const payload = JSON.parse(event.body || '{}');
      await store.set(STATE_KEY, JSON.stringify(payload));
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true })
      };
    } catch (error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ ok: false, error: 'Invalid JSON payload' })
      };
    }
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ ok: false, error: 'Method not allowed' })
  };
};
