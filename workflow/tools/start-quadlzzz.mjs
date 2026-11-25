import {runUxpBridge} from '../src/premiere/uxp-proxy-supervisor.mjs';
try {process.exitCode=await runUxpBridge({runtime:process.argv[2]});}
catch(error){console.error(`[premiere uxp] ${error.message}`);process.exitCode=1;}
