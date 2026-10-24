import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {aiConfig} from '../src/ai-config.mjs';
function fileTest(fn){const filename=path.join(os.tmpdir(),'geobridge-keys-'+crypto.randomUUID()+'.env');try{fn(filename,{GEOBRIDGE_AI_ENV_FILE:filename})}finally{fs.rmSync(filename,{force:true})}}

test('numbered mixed-provider dotenv keys are discovered automatically in file order',()=>fileTest((filename,env)=>{
 fs.writeFileSync(filename,'# Private test data\nOPENAI_MODEL=test-openai\nGEMINI_MODEL=test-gemini\nCLAUDE_MODEL=test-claude\nGROK_MODEL=test-grok\nOPENAI_API_KEY_2=openai-two\nGOOGLE_API_KEY="google-one"\nGOOGLE_API_KEY_2=google-two # comment\nGOOGLE_API_KEY_3=\nANTHROPIC_API_KEY=claude-one\nXAI_API_KEY_7=grok-seven\n');
 const config=aiConfig(env);assert.equal(config.connections.length,5);assert.deepEqual(config.connections.map(c=>c.provider),['openai','gemini','gemini','claude','grok']);assert.equal(config.connections[2].key,'google-two');assert.equal(config.connections[2].quotaGroup,'gemini');assert.equal(config.warnings.length,0);
}));

test('per-key models and explicitly independent quota groups are honored; duplicate aliases are deduplicated',()=>fileTest((filename,env)=>{
 fs.writeFileSync(filename,'GEMINI_MODEL=default-model\nGEMINI_MODEL_2=specific-model\nGOOGLE_API_KEY=same-key\nGEMINI_API_KEY=same-key\nGOOGLE_API_KEY_2=second-key\nGOOGLE_QUOTA_GROUP_2=independent-project\n');const config=aiConfig(env);assert.equal(config.connections.length,2);assert.equal(config.connections[1].model,'specific-model');assert.equal(config.connections[1].quotaGroup,'independent-project');
}));

test('missing model produces a nonsecret warning and never sends the key to an arbitrary model',()=>fileTest((filename,env)=>{
 fs.writeFileSync(filename,'GOOGLE_API_KEY=private-test-value\n');const config=aiConfig(env);assert.equal(config.configured,false);assert(config.warnings[0].includes('GEMINI_MODEL'));assert(!JSON.stringify(config).includes('private-test-value'));
}));

test('dotenv is data, never shell code, and unrelated application settings are ignored',()=>fileTest((filename,env)=>{
 fs.writeFileSync(filename,'GEMINI_MODEL=test-model\nGOOGLE_API_KEY="$(echo should-not-execute)"\nGEOBRIDGE_ORIGIN=https://attacker.example\n');const config=aiConfig(env);assert.equal(config.configured,false);assert(config.warnings[0].includes('Invalid key formatting'));assert.notEqual(process.env.GEOBRIDGE_ORIGIN,'https://attacker.example');
}));

test('editing key files changes configuration identity without restart, and an empty file disables the pool',()=>fileTest((filename,env)=>{
 fs.writeFileSync(filename,'GEMINI_MODEL=model\nGOOGLE_API_KEY=first\n');const first=aiConfig(env);fs.writeFileSync(filename,'GEMINI_MODEL=model\nGOOGLE_API_KEY=second\n');assert.notEqual(aiConfig(env).model,first.model);fs.writeFileSync(filename,'# disabled\n');assert.equal(aiConfig({...env,GEOBRIDGE_AI_KEY:'legacy',GEOBRIDGE_AI_MODEL:'legacy-model'}).configured,false);
}));
