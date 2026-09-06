const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL || 'https://YOUR_PROJECT_REF.supabase.co';
const key = process.env.SUPABASE_ANON_KEY || 'YOUR_ANON_KEY';

const content = `window.SUPABASE_URL = '${url.replace(/'/g, "\\'")}';\nwindow.SUPABASE_ANON_KEY = '${key.replace(/'/g, "\\'")}';\n`;

fs.writeFileSync(path.join(__dirname, 'supabase-config.js'), content, 'utf8');
console.log('Generated supabase-config.js');
