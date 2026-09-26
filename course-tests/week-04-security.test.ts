/**
 * Negative tests for CampusOps security controls — Week 04.
 *
 * These tests verify that sensitive information does NOT appear in:
 * - Logs (via redactForTelemetry)
 * - Error reports
 * - Telemetry output
 *
 * Related threats: T-03 (data leakage in logs), T-04 (credential exposure),
 * T-05 (photo access), T-06 (location exposure).
 */

import { redactForTelemetry } from '../src/course-evaluation';
import {
  createInMemorySecureStorage,
  sanitizedLog,
  reportErrorSafely,
} from '../src/infrastructure/secureStorage';

// ---------------------------------------------------------------------------
// 1. redactForTelemetry — core sanitization tests
// ---------------------------------------------------------------------------

describe('redactForTelemetry — sanitization contract', () => {
  test('redacts all 20 sensitive fields defined in CAMPUSOPS_API.md', () => {
    const input = {
      authorization: 'Bearer course-valid-token',
      password: 'secret-password',
      token: 'some-token',
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
      email: 'person@campusops.test',
      displayName: 'Persona Ficticia',
      name: 'Nombre Ficticio',
      userId: 'user-001',
      reporterId: 'reporter-1',
      technicianId: 'technician-1',
      assignedTechnicianId: 'technician-2',
      location: 'Edificio B, laboratorio 2',
      latitude: 20.6597,
      longitude: -103.3496,
      photos: ['photo-1.jpg', 'photo-2.jpg'],
      evidence: ['evidence-file-1'],
      internalComments: ['Nota interna ficticia'],
      assignmentHistory: [{ from: 'tech-1', to: 'tech-2' }],
      // Technical fields that must be PRESERVED
      incidentId: 'campus-inc-001',
      correlationId: 'corr-abc-123',
      status: 'assigned',
      attempt: 3,
      durationMs: 1500,
    };

    const result = redactForTelemetry(input) as Record<string, unknown>;

    // All sensitive fields → [REDACTED]
    expect(result.authorization).toBe('[REDACTED]');
    expect(result.password).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.refreshToken).toBe('[REDACTED]');
    expect(result.email).toBe('[REDACTED]');
    expect(result.displayName).toBe('[REDACTED]');
    expect(result.name).toBe('[REDACTED]');
    expect(result.userId).toBe('[REDACTED]');
    expect(result.reporterId).toBe('[REDACTED]');
    expect(result.technicianId).toBe('[REDACTED]');
    expect(result.assignedTechnicianId).toBe('[REDACTED]');
    expect(result.location).toBe('[REDACTED]');
    expect(result.latitude).toBe('[REDACTED]');
    expect(result.longitude).toBe('[REDACTED]');
    expect(result.photos).toBe('[REDACTED]');
    expect(result.evidence).toBe('[REDACTED]');
    expect(result.internalComments).toBe('[REDACTED]');
    expect(result.assignmentHistory).toBe('[REDACTED]');

    // Technical fields preserved
    expect(result.incidentId).toBe('campus-inc-001');
    expect(result.correlationId).toBe('corr-abc-123');
    expect(result.status).toBe('assigned');
    expect(result.attempt).toBe(3);
    expect(result.durationMs).toBe(1500);
  });

  test('does not mutate the original input object', () => {
    const original = {
      authorization: 'Bearer course-valid-token',
      email: 'person@campusops.test',
      incidentId: 'campus-inc-001',
      nested: {
        password: 'deep-secret',
        status: 'open',
      },
    };

    // Deep-freeze to detect mutation attempts
    const frozen = JSON.parse(JSON.stringify(original));

    redactForTelemetry(original);

    expect(original).toEqual(frozen);
    expect(original.authorization).toBe('Bearer course-valid-token');
    expect(original.email).toBe('person@campusops.test');
    expect(original.nested.password).toBe('deep-secret');
  });

  test('recurses into nested objects and redacts deeply', () => {
    const input = {
      request: {
        headers: {
          authorization: 'Bearer course-valid-token',
          accept: 'application/json',
        },
      },
      profile: {
        email: 'person@campusops.test',
        displayName: 'Persona Ficticia',
      },
      incident: {
        incidentId: 'campus-inc-001',
        location: 'Zona ficticia',
        details: {
          photos: ['img-1.jpg'],
          evidence: ['file-1'],
          internalComments: ['Nota secreta'],
          correlationId: 'corr-123',
        },
      },
    };

    const result = redactForTelemetry(input) as Record<string, unknown>;
    const request = result.request as Record<string, unknown>;
    const headers = request.headers as Record<string, unknown>;
    const profile = result.profile as Record<string, unknown>;
    const incident = result.incident as Record<string, unknown>;
    const details = incident.details as Record<string, unknown>;

    expect(headers.authorization).toBe('[REDACTED]');
    expect(headers.accept).toBe('application/json');
    expect(profile.email).toBe('[REDACTED]');
    expect(profile.displayName).toBe('[REDACTED]');
    expect(incident.incidentId).toBe('campus-inc-001');
    expect(incident.location).toBe('[REDACTED]');
    expect(details.photos).toBe('[REDACTED]');
    expect(details.evidence).toBe('[REDACTED]');
    expect(details.internalComments).toBe('[REDACTED]');
    expect(details.correlationId).toBe('corr-123');
  });

  test('handles arrays of objects — redacts each element independently', () => {
    const input = [
      { email: 'a@test.com', incidentId: 'inc-001', status: 'open' },
      { email: 'b@test.com', incidentId: 'inc-002', status: 'closed' },
    ];

    const result = redactForTelemetry(input) as Array<Record<string, unknown>>;

    expect(result).toHaveLength(2);
    expect(result[0].email).toBe('[REDACTED]');
    expect(result[0].incidentId).toBe('inc-001');
    expect(result[1].email).toBe('[REDACTED]');
    expect(result[1].incidentId).toBe('inc-002');
  });

  test('handles key normalization — underscore/hyphen variants', () => {
    const input = {
      access_token: 'should-be-redacted',
      'refresh-token': 'should-be-redacted',
      internal_comments: 'should-be-redacted',
      'assignment-history': 'should-be-redacted',
      'assigned_technician_id': 'should-be-redacted',
      incident_id: 'should-NOT-be-redacted', // not in sensitive list
    };

    const result = redactForTelemetry(input) as Record<string, unknown>;

    expect(result.access_token).toBe('[REDACTED]');
    expect(result['refresh-token']).toBe('[REDACTED]');
    expect(result.internal_comments).toBe('[REDACTED]');
    expect(result['assignment-history']).toBe('[REDACTED]');
    expect(result['assigned_technician_id']).toBe('[REDACTED]');
    // 'incident_id' normalizes to 'incidentid', which is NOT in the set
    // (the set has 'incidentId' → normalizes to 'incidentid' — wait, no,
    //  'incidentId' is not in the sensitive set, it's a safe field!)
  });

  test('returns primitives unchanged', () => {
    expect(redactForTelemetry(null)).toBeNull();
    expect(redactForTelemetry(undefined)).toBeUndefined();
    expect(redactForTelemetry(42)).toBe(42);
    expect(redactForTelemetry('hello')).toBe('hello');
    expect(redactForTelemetry(true)).toBe(true);
  });

  test('handles empty objects and arrays', () => {
    expect(redactForTelemetry({})).toEqual({});
    expect(redactForTelemetry([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Negative tests — sensitive data must NOT appear in error paths
// ---------------------------------------------------------------------------

describe('Negative tests — error paths do not leak sensitive data', () => {
  let logOutput: string[];

  beforeEach(() => {
    logOutput = [];
    // Capture console output for assertion
    jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '));
    });
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '));
    });
    jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('sanitizedLog redacts sensitive context before logging', () => {
    sanitizedLog('info', 'Incident fetched', {
      incidentId: 'campus-inc-001',
      email: 'person@campusops.test',
      authorization: 'Bearer secret-token',
      latitude: 20.6597,
      longitude: -103.3496,
    });

    const output = logOutput.join('\n');

    // Must NOT contain raw sensitive values
    expect(output).not.toContain('person@campusops.test');
    expect(output).not.toContain('Bearer secret-token');
    expect(output).not.toContain('20.6597');
    expect(output).not.toContain('-103.3496');

    // Must contain redaction markers and safe fields
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('campus-inc-001');
  });

  test('reportErrorSafely does not leak sensitive data from errors', () => {
    const error = new Error('Network request failed');
    reportErrorSafely(error, {
      userId: 'user-test-123',
      accessToken: 'at-secret-value',
      incidentId: 'campus-inc-002',
      photos: ['photo-leaked.jpg'],
    });

    const output = logOutput.join('\n');

    expect(output).not.toContain('user-test-123');
    expect(output).not.toContain('at-secret-value');
    expect(output).not.toContain('photo-leaked.jpg');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('campus-inc-002');
    expect(output).toContain('Network request failed');
  });

  test('redacted error context — tokens from failed API call', () => {
    // Simulates a failed API call where response includes sensitive info
    const failedResponse = {
      status: 500,
      attempt: 2,
      durationMs: 3200,
      request: {
        headers: {
          authorization: 'Bearer leaked-token',
          'X-Course-Actor': 'reporter-1',
        },
        body: {
          description: 'Falla eléctrica',
          location: 'Edificio B',
          reporterId: 'reporter-1',
        },
      },
    };

    const sanitized = redactForTelemetry(failedResponse) as Record<string, unknown>;
    const request = sanitized.request as Record<string, unknown>;
    const headers = request.headers as Record<string, unknown>;
    const body = request.body as Record<string, unknown>;

    // Technical fields preserved for debugging
    expect(sanitized.status).toBe(500);
    expect(sanitized.attempt).toBe(2);
    expect(sanitized.durationMs).toBe(3200);

    // Sensitive fields redacted
    expect(headers.authorization).toBe('[REDACTED]');
    expect(body.location).toBe('[REDACTED]');
    expect(body.reporterId).toBe('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// 3. Secure storage tests
// ---------------------------------------------------------------------------

describe('Secure storage — in-memory fallback', () => {
  test('stores and retrieves values correctly', async () => {
    const store = createInMemorySecureStorage();
    await store.setItem('sessionToken', 'course-valid-token');

    const value = await store.getItem('sessionToken');
    expect(value).toBe('course-valid-token');
  });

  test('returns null for missing keys', async () => {
    const store = createInMemorySecureStorage();
    const value = await store.getItem('nonexistent');
    expect(value).toBeNull();
  });

  test('deletes values correctly', async () => {
    const store = createInMemorySecureStorage();
    await store.setItem('token', 'value');
    await store.deleteItem('token');

    const value = await store.getItem('token');
    expect(value).toBeNull();
  });

  test('token values do not appear in log output after storage', async () => {
    const store = createInMemorySecureStorage();
    await store.setItem('accessToken', 'super-secret-token');

    // Even if someone logs the storage operation context,
    // redactForTelemetry should protect it
    const context = {
      action: 'token_stored',
      accessToken: 'super-secret-token',
      incidentId: 'campus-inc-001',
    };

    const sanitized = redactForTelemetry(context) as Record<string, unknown>;
    expect(sanitized.accessToken).toBe('[REDACTED]');
    expect(sanitized.incidentId).toBe('campus-inc-001');
  });
});
