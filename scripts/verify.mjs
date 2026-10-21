import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const result=spawnSync(process.execPath,['--test','tests/core.test.mjs','tests/integration.test.mjs','tests/ui-render.test.mjs','tests/roles.test.mjs','tests/spec-audit.test.mjs'],{cwd:root,encoding:'utf8'});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
const report={at:new Date().toISOString(),node:process.version,exitCode:result.status,checks:['Deterministic controls and capture validation','HTTP authentication, CSRF, worker, exports and role isolation','Role-specific homes/navigation and all workspace views render using a controlled DOM harness'],browserVisualQA:'Not completed: local preview could not be reached by browser tool',bankIntegration:'Not configured',liveAI:'Not exercised without key/model',output:result.stdout};
fs.writeFileSync(path.join(root,'docs','verification.json'),JSON.stringify(report,null,2));
process.exitCode=result.status||0;
