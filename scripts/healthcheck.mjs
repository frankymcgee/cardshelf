import { readFile } from 'node:fs/promises';
try {
  if(process.argv[2]==='worker') {
    const timestamp=Number(await readFile('/tmp/cardshelf-worker-heartbeat','utf8'));
    if(!Number.isFinite(timestamp) || Date.now()-timestamp>120000) throw new Error('Worker heartbeat is stale.');
  } else {
    const response=await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(5000)});
    if(!response.ok) throw new Error('Application is unhealthy.');
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
