import {parentPort,workerData} from 'node:worker_threads';
import {get,put} from './store.mjs';
import {executeRun} from './engine.mjs';
try{const r=get('runs',workerData.id);if(!r)throw Error('Run not found');put('runs',{...r,status:'running',progress:25});await executeRun(r);parentPort.postMessage({ok:true})}catch(e){const r=get('runs',workerData.id);if(r)put('runs',{...(e.auditResult||r),status:'failed',error:e.message,...(e.auditResult?{reportStatus:'failed'}:{})});parentPort.postMessage({ok:false})}
