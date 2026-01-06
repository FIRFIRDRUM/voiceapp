const electron = require('electron');
console.log('--- DEBUG INFO ---');
console.log('Process Versions:', process.versions);
console.log('Electron Path required:', electron);
console.log('Is App Available?:', !!electron.app);
console.log('Type of App:', typeof electron.app);
console.log('--- DEBUG END ---');
