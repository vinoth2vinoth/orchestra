const { execSync } = require('child_process');
try {
    execSync('pkill -f tsx');
} catch (e) {}
console.log('Killed all tsx processes');
