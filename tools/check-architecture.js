// Comprueba que la capa UI no importe directamente de infrastructure.
// Recorre src/ui/**/*.tsx y src/ui/**/*.ts buscando imports que apunten a "infrastructure".

const fs = require('fs');
const path = require('path');

const UI_DIR = path.join(process.cwd(), 'src', 'ui');
const VIOLATION_PATTERN = /from\s+['"].*infrastructure[^'"]*['"]/;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walk(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function main() {
  if (!fs.existsSync(UI_DIR)) {
    console.error(`No existe la carpeta ${UI_DIR}`);
    process.exit(2);
  }

  const files = walk(UI_DIR);
  const violations = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (VIOLATION_PATTERN.test(line)) {
        violations.push({
          file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
          line: index + 1,
          content: line.trim(),
        });
      }
    });
  }

  if (violations.length > 0) {
    console.log('VIOLATION: UI importa directamente de infrastructure');
    for (const v of violations) {
      console.log(`  ${v.file}:${v.line} -> ${v.content}`);
    }
    process.exit(1);
  }

  console.log('OK: ninguna importación directa de UI a infrastructure');
  process.exit(0);
}

main();