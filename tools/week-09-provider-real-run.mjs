// Ejecución real con el proveedor (Nominatim/OpenStreetMap). Una sola solicitud, datos públicos y ficticios.
// Uso: node tools/week-09-provider-real-run.mjs   (escribe reports/week-09/provider-real-run.json)
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const QUERY = 'Palacio de Bellas Artes, Ciudad de México';
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'CampusOps-DMI-student-test/1.0 (equipo CampusOps)';

const started = Date.now();
let status = null;
let body = null;
let failure = null;
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const response = await fetch(`${ENDPOINT}?${new URLSearchParams({ q: QUERY, format: 'jsonv2', limit: '1' })}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: controller.signal,
  });
  clearTimeout(timer);
  status = response.status;
  body = response.ok ? await response.json() : null;
} catch (error) {
  failure = error?.name === 'AbortError' ? 'timeout' : 'network';
}
const elapsedMs = Date.now() - started;

const first = Array.isArray(body) ? body[0] : null;
const location = first
  ? { label: first.display_name, latitude: Number(first.lat), longitude: Number(first.lon) }
  : null;
const valid = location !== null
  && typeof location.label === 'string' && location.label.trim() !== ''
  && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90
  && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180;

const report = {
  schemaVersion: 1,
  week: 9,
  commitSha: execSync('git rev-parse HEAD').toString().trim(),
  generatedAt: new Date().toISOString(),
  provider: 'Nominatim (OpenStreetMap)',
  endpoint: ENDPOINT,
  note: 'Consulta de un lugar público; sin datos personales, de incidencias ni credenciales. Una sola solicitud (límite del proveedor: 1 por segundo).',
  checks: [
    {
      id: 'provider-real-geocoding',
      status: valid ? 'pass' : 'fail',
      scenarioType: 'nominal',
      command: 'node tools/week-09-provider-real-run.mjs',
      evidence: { query: QUERY, httpStatus: status, failure, elapsedMs, resultAccepted: valid, location },
    },
  ],
};
mkdirSync('reports/week-09', { recursive: true });
writeFileSync('reports/week-09/provider-real-run.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.checks[0], null, 2));
process.exit(valid ? 0 : 1);
