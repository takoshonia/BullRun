import test from 'node:test';
import assert from 'node:assert/strict';
import {bankReadiness} from '../src/bank-readiness.mjs';
test('unconfigured banks identify missing adapter, credentials, and consent',()=>{const r=bankReadiness({id:'bank',adapter:null},[]);assert.equal(r.ready,false);assert.deepEqual(r.reasons.map(x=>x.code),['ADAPTER_NOT_CONFIGURED','CREDENTIALS_NOT_CONFIGURED','CONSENT_NOT_AVAILABLE'])});
test('only the exact configured mock adapter is ready, with simulated authorization',()=>{const targets=[{id:'mock-bank',adapter:'mock-v1'}];const r=bankReadiness({id:'mock-bank',adapter:'mock-v1'},targets);assert.equal(r.ready,true);assert.equal(r.mode,'synthetic_mock');assert.match(r.authorization,/Simulated consent/);assert.equal(bankReadiness({id:'mock-bank',adapter:'wrong'},targets).ready,false)});
