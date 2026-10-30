// Cashfree Payment Gateway integration (API Version: 2023-08-01)
const crypto = require('crypto');
const https = require('https');

const APP_ID = process.env.CASHFREE_APP_ID || '';
const SECRET_KEY = process.env.CASHFREE_SECRET_KEY || '';
const ENV = (process.env.CASHFREE_ENV || 'sandbox').toLowerCase();
const API_VERSION = '2023-08-01';

const BASE_URLS = {
  sandbox: 'https://sandbox.cashfree.com/pg',
  production: 'https://api.cashfree.com/pg',
};

const BASE_URL = BASE_URLS[ENV] || BASE_URLS.sandbox;

function isConfigured() {
  return Boolean(APP_ID && SECRET_KEY);
}

function request(method, endpoint, payload = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${endpoint}`);
    const bodyStr = payload ? JSON.stringify(payload) : null;

    const options = {
      method,
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      headers: {
        'x-client-id': APP_ID,
        'x-client-secret': SECRET_KEY,
        'x-api-version': API_VERSION,
        'Content-Type': 'application/json',
      },
    };

    if (bodyStr) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch (e) {
          return reject(new Error(`Invalid JSON response from Cashfree: ${data.slice(0, 100)}`));
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve(parsed);
        }

        const msg = parsed?.message || `Cashfree request failed with HTTP ${res.statusCode}`;
        const err = new Error(msg);
        err.statusCode = res.statusCode;
        err.data = parsed;
        reject(err);
      });
    });

    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Creates an order in Cashfree.
 * Returns order details including payment_session_id.
 */
async function createOrder({ orderId, orderAmount, customerId, customerPhone, customerName, customerEmail, returnUrl, notifyUrl }) {
  if (!isConfigured()) {
    throw new Error('Cashfree credentials are not configured on the server.');
  }

  // Format 10-digit mobile number for Cashfree
  const phoneDigits = String(customerPhone || '').replace(/\D/g, '').slice(-10) || '9999999999';

  const body = {
    order_id: String(orderId),
    order_amount: Number(orderAmount),
    order_currency: 'INR',
    customer_details: {
      customer_id: String(customerId),
      customer_phone: phoneDigits,
      customer_name: customerName || 'Customer',
      customer_email: customerEmail || 'customer@jothidaconnect.in',
    },
    order_meta: {},
  };

  if (returnUrl) body.order_meta.return_url = returnUrl;
  if (notifyUrl) body.order_meta.notify_url = notifyUrl;

  return request('POST', '/orders', body);
}

/**
 * Retrieves order status from Cashfree.
 */
async function getOrder(orderId) {
  if (!isConfigured()) {
    throw new Error('Cashfree credentials are not configured on the server.');
  }
  return request('GET', `/orders/${encodeURIComponent(orderId)}`);
}

/**
 * Verifies the webhook signature using HMAC-SHA256.
 */
function verifyWebhook(rawBody, signature, timestamp) {
  if (!SECRET_KEY || !signature || !timestamp || !rawBody) return false;
  try {
    const payload = `${timestamp}${rawBody}`;
    const expected = crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('base64');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (e) {
    return false;
  }
}

module.exports = {
  isConfigured,
  createOrder,
  getOrder,
  verifyWebhook,
  ENV,
  BASE_URL,
};
