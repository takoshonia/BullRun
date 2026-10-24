import fs from 'node:fs';

// A mounted secret file can be updated without rebuilding an image or exposing a key in the UI.
export function aiConfig(env=process.env){
 let key=env.GEOBRIDGE_AI_KEY||'',model=env.GEOBRIDGE_AI_MODEL||'';
 try{if(!key&&env.GEOBRIDGE_AI_KEY_FILE)key=fs.readFileSync(env.GEOBRIDGE_AI_KEY_FILE,'utf8').trim()}catch{key=''}
 try{if(!model&&env.GEOBRIDGE_AI_MODEL_FILE)model=fs.readFileSync(env.GEOBRIDGE_AI_MODEL_FILE,'utf8').trim()}catch{model=''}
 return {key,model,configured:!!key&&!!model};
}
