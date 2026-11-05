import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizePrivateKey(value) {
  return String(value ?? '').replace(/\\n/g, '\n');
}

function parseServiceAccountJson(raw) {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Google service account JSON must include client_email and private_key');
  }
  return parsed;
}

export function loadGoogleServiceAccount(env = process.env) {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return parseServiceAccountJson(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }

  if (env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    const decoded = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8');
    return parseServiceAccountJson(decoded);
  }

  if (env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH) {
    return parseServiceAccountJson(readFileSync(env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH, 'utf8'));
  }

  if (env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return {
      client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: normalizePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
      token_uri: env.GOOGLE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
    };
  }

  return null;
}

function signJwt({ header, payload, privateKey }) {
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(privateKey));
  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`;
}

export class GoogleServiceAccountAuth {
  constructor({
    scopes,
    subject = process.env.GOOGLE_IMPERSONATED_USER || '',
    serviceAccount = loadGoogleServiceAccount(process.env),
    fetchImpl = fetch,
    now = () => Date.now(),
  }) {
    this.scopes = scopes;
    this.subject = subject;
    this.serviceAccount = serviceAccount;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cachedToken = null;
  }

  isConfigured() {
    return Boolean(this.serviceAccount?.client_email && this.serviceAccount?.private_key);
  }

  async accessToken() {
    if (!this.isConfigured()) {
      throw new Error('Google service account credentials are not configured');
    }

    const nowSeconds = Math.floor(this.now() / 1000);
    if (this.cachedToken?.access_token && nowSeconds < (this.cachedToken.expires_at - 60)) {
      return this.cachedToken.access_token;
    }

    const payload = {
      iss: this.serviceAccount.client_email,
      scope: this.scopes.join(' '),
      aud: this.serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
      exp: nowSeconds + 3600,
      iat: nowSeconds,
    };
    if (this.subject) payload.sub = this.subject;

    const assertion = signJwt({
      header: { alg: 'RS256', typ: 'JWT' },
      payload,
      privateKey: this.serviceAccount.private_key,
    });

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });

    const response = await this.fetchImpl(this.serviceAccount.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Google OAuth token request failed with ${response.status}`);
    }

    const payloadJson = await response.json();
    if (!payloadJson.access_token) {
      throw new Error(`Google OAuth token response missing access_token: ${JSON.stringify(payloadJson)}`);
    }

    this.cachedToken = {
      access_token: payloadJson.access_token,
      expires_at: nowSeconds + Number(payloadJson.expires_in ?? 3600),
    };
    return this.cachedToken.access_token;
  }
}
