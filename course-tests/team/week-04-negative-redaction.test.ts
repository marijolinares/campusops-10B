import { redactForTelemetry } from '../../src/course-evaluation';

const RAW_TOKEN = 'course-token-do-not-log-9f3a';
const RAW_TECHNICIAN = 'technician-1';
const RAW_LOCATION = 'Edificio B, laboratorio 4';
const RAW_PHOTO = 'synthetic-photo-42';
const RAW_COMMENT = 'El reportante insiste en que fue negligencia del técnico';

test('normal telemetry log never contains raw sensitive values, only [REDACTED]', () => {
  const normalLog = {
    event: 'incident.action.recorded',
    incidentId: 'campus-inc-002',
    correlationId: 'corr-777',
    durationMs: 42,
    request: {
      headers: { authorization: `Bearer ${RAW_TOKEN}`, accept: 'application/json' },
    },
    actor: {
      technicianId: RAW_TECHNICIAN,
      displayName: 'Técnico ficticio',
      email: 'tecnico@campusops.test',
    },
    incident: {
      location: RAW_LOCATION,
      latitude: 19.041,
      longitude: -98.198,
      photos: [RAW_PHOTO],
      internalComments: [RAW_COMMENT],
    },
  };

  const redacted = redactForTelemetry(normalLog);
  const serialized = JSON.stringify(redacted);

  for (const secret of [RAW_TOKEN, RAW_TECHNICIAN, RAW_LOCATION, RAW_PHOTO, RAW_COMMENT]) {
    expect(serialized).not.toContain(secret);
  }
  expect(serialized).toContain('[REDACTED]');
  expect(redacted).toMatchObject({
    incidentId: 'campus-inc-002',
    correlationId: 'corr-777',
    durationMs: 42,
  });
});

test('error-path context never contains raw sensitive values either', () => {
  const errorContext = {
    error: 'assignment_conflict',
    status: 409,
    attempt: 2,
    context: {
      reporterId: 'reporter-1',
      assignedTechnicianId: RAW_TECHNICIAN,
      assignmentHistory: [{ technicianId: RAW_TECHNICIAN, at: '2026-09-01T10:00:00Z' }],
      refreshToken: RAW_TOKEN,
    },
  };

  const redacted = redactForTelemetry(errorContext);
  const serialized = JSON.stringify(redacted);

  expect(serialized).not.toContain(RAW_TECHNICIAN);
  expect(serialized).not.toContain(RAW_TOKEN);
  expect(redacted).toMatchObject({ error: 'assignment_conflict', status: 409, attempt: 2 });
});

test('sensitive keys are matched regardless of case, snake_case or kebab-case', () => {
  const messyKeys = {
    ACCESS_TOKEN: RAW_TOKEN,
    'display-name': 'Persona ficticia',
    Reporter_Id: 'reporter-2',
    incidentId: 'campus-inc-003',
  };

  const redacted = redactForTelemetry(messyKeys) as Record<string, unknown>;

  expect(redacted.ACCESS_TOKEN).toBe('[REDACTED]');
  expect(redacted['display-name']).toBe('[REDACTED]');
  expect(redacted.Reporter_Id).toBe('[REDACTED]');
  expect(redacted.incidentId).toBe('campus-inc-003');
});

test('the original input object is never mutated', () => {
  const original = {
    incidentId: 'campus-inc-004',
    actor: { technicianId: RAW_TECHNICIAN, email: 'tecnico2@campusops.test' },
    photos: [RAW_PHOTO],
  };
  const snapshotBeforeCall = JSON.parse(JSON.stringify(original));

  redactForTelemetry(original);

  expect(original).toEqual(snapshotBeforeCall);
});

test('a list of telemetry records (not just a single object) is fully sanitized', () => {
  const records = [
    { incidentId: 'campus-inc-005', technicianId: RAW_TECHNICIAN },
    { incidentId: 'campus-inc-006', location: RAW_LOCATION },
  ];

  const redacted = redactForTelemetry(records);
  const serialized = JSON.stringify(redacted);

  expect(serialized).not.toContain(RAW_TECHNICIAN);
  expect(serialized).not.toContain(RAW_LOCATION);
  expect(Array.isArray(redacted)).toBe(true);
});