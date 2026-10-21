import {parentPort,workerData} from 'node:worker_threads';
import {get,put} from './store.mjs';
import {executeRun} from './engine.mjs';
try{const r=get('runs',workerData.id);if(!r)throw Error('Run not found');put('runs',{...r,status:'running',progress:25});executeRun(r);parentPort.postMessage({ok:true})}catch(e){const r=get('runs',workerData.id);if(r)put('runs',{...r,status:'failed',error:e.message});parentPort.postMessage({ok:false})}
