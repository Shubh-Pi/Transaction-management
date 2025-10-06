/** @global {KVNamespace} PERSONS_KV */
/** @global {KVNamespace} TRANSACTIONS_KV */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
});

async function handleRequest(request) {
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  try {
    // --- Persons API ---
    if (path.startsWith('/api/persons')) {
      const parts = path.split('/');
      const personId = parts.length > 3 ? parts[3] : null;

      if (method === 'GET') {
        const list = await PERSONS_KV.list();
        const persons = await Promise.all(
          list.keys.map(async key => {
            const value = await PERSONS_KV.get(key.name, { type: 'json' });
            return value;
          })
        );
        return jsonResponse(persons.filter(p => p !== null));
      }

      else if (method === 'POST') {
        let person;
        try {
          person = await request.json();
        } catch (e) {
          return jsonResponse({ error: 'Invalid JSON format' }, 400);
        }

        // Validate required fields
        if (!person || !person.id || !person.name) {
          return jsonResponse({ error: 'Missing required fields: id and name' }, 400);
        }

        // Sanitize input
        person.name = String(person.name).trim();
        if (person.name.length === 0 || person.name.length > 100) {
          return jsonResponse({ error: 'Name must be between 1 and 100 characters' }, 400);
        }

        await PERSONS_KV.put(person.id, JSON.stringify(person));
        return jsonResponse(person);
      }

      else if (method === 'DELETE') {
        if (!personId) {
          return jsonResponse({ error: 'Person ID missing' }, 400);
        }

        // CRITICAL FIX: Delete all transactions for this person
        const txList = await TRANSACTIONS_KV.list();
        const deletePromises = [];

        for (const key of txList.keys) {
          const tx = await TRANSACTIONS_KV.get(key.name, { type: 'json' });
          if (tx && tx.personId === personId) {
            deletePromises.push(TRANSACTIONS_KV.delete(key.name));
          }
        }

        // Wait for all transaction deletions to complete
        await Promise.all(deletePromises);

        // Now delete the person
        await PERSONS_KV.delete(personId);

        return jsonResponse({
          success: true,
          message: 'Person and all associated transactions deleted',
          deletedTransactions: deletePromises.length
        });
      }

      else {
        return jsonResponse({ error: 'Method Not Allowed' }, 405);
      }
    }

    // --- Transactions API ---
    if (path.startsWith('/api/transactions')) {
      const parts = path.split('/');
      const txId = parts.length > 3 ? parts[3] : null;

      if (method === 'GET') {
        const list = await TRANSACTIONS_KV.list();
        const txs = await Promise.all(
          list.keys.map(async key => {
            const value = await TRANSACTIONS_KV.get(key.name, { type: 'json' });
            return value;
          })
        );
        return jsonResponse(txs.filter(tx => tx !== null));
      }

      else if (method === 'POST') {
        let tx;
        try {
          tx = await request.json();
        } catch (e) {
          return jsonResponse({ error: 'Invalid JSON format' }, 400);
        }

        // Validate required fields
        if (!tx || !tx.id || !tx.personId || !tx.type || !tx.amount) {
          return jsonResponse({ error: 'Missing required fields: id, personId, type, amount' }, 400);
        }

        // Validate transaction type
        const validTypes = ['received', 'payment', 'print'];
        if (!validTypes.includes(tx.type)) {
          return jsonResponse({ error: 'Invalid transaction type. Must be: received, payment, or print' }, 400);
        }

        // Validate amount
        const amount = parseFloat(tx.amount);
        if (isNaN(amount) || amount <= 0) {
          return jsonResponse({ error: 'Amount must be a positive number' }, 400);
        }
        tx.amount = amount;

        // Sanitize description
        if (tx.description) {
          tx.description = String(tx.description).trim().substring(0, 500);
        }

        // Verify person exists
        const person = await PERSONS_KV.get(tx.personId);
        if (!person) {
          return jsonResponse({ error: 'Person not found' }, 404);
        }

        await TRANSACTIONS_KV.put(tx.id, JSON.stringify(tx));
        return jsonResponse(tx);
      }

      else if (method === 'PATCH') {
        if (!txId) {
          return jsonResponse({ error: 'Transaction ID missing' }, 400);
        }

        let updates;
        try {
          updates = await request.json();
        } catch (e) {
          return jsonResponse({ error: 'Invalid JSON format' }, 400);
        }

        const txDataStr = await TRANSACTIONS_KV.get(txId);
        if (!txDataStr) {
          return jsonResponse({ error: 'Transaction not found' }, 404);
        }

        const txData = JSON.parse(txDataStr);

        // Validate updates if provided
        if (updates.type) {
          const validTypes = ['received', 'payment', 'print'];
          if (!validTypes.includes(updates.type)) {
            return jsonResponse({ error: 'Invalid transaction type' }, 400);
          }
        }

        if (updates.amount !== undefined) {
          const amount = parseFloat(updates.amount);
          if (isNaN(amount) || amount <= 0) {
            return jsonResponse({ error: 'Amount must be a positive number' }, 400);
          }
          updates.amount = amount;
        }

        if (updates.description) {
          updates.description = String(updates.description).trim().substring(0, 500);
        }

        const updatedTx = { ...txData, ...updates };
        await TRANSACTIONS_KV.put(txId, JSON.stringify(updatedTx));
        return jsonResponse(updatedTx);
      }

      else if (method === 'DELETE') {
        if (!txId) {
          return jsonResponse({ error: 'Transaction ID missing' }, 400);
        }

        const exists = await TRANSACTIONS_KV.get(txId);
        if (!exists) {
          return jsonResponse({ error: 'Transaction not found' }, 404);
        }

        await TRANSACTIONS_KV.delete(txId);
        return jsonResponse({ success: true, message: 'Transaction deleted' });
      }

      else {
        return jsonResponse({ error: 'Method Not Allowed' }, 405);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404);

  } catch (error) {
    console.error('Worker error:', error);
    return jsonResponse({
      error: 'Internal server error',
      message: error.message
    }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
