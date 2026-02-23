const fs = require('fs');
const path = require('path');

const targetDir = __dirname;
const walkSync = (dir, filelist = []) => {
  fs.readdirSync(dir).forEach(file => {
    const dirFile = path.join(dir, file);
    if (fs.statSync(dirFile).isDirectory()) {
      if (!dirFile.includes('node_modules') && !dirFile.includes('.git') && !dirFile.includes('.gemini')) {
        filelist = walkSync(dirFile, filelist);
      }
    } else {
      if (dirFile.match(/\.(js|json|txt|md|html|css)$/)) {
        filelist.push(dirFile);
      }
    }
  });
  return filelist;
};

const mapGerman = {
  'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
  'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue'
};

const files = walkSync(targetDir);

files.forEach(file => {
  if (file.endsWith('logs.txt') || file.endsWith('clean_chars.js')) return;

  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // 1. Transliterate German chars
  for (const [key, val] of Object.entries(mapGerman)) {
    content = content.replace(new RegExp(key, 'g'), val);
  }

  // 2. Transliterate quotes and dashes
  content = content.replace(/['"]/g, "'").replace(/[„“”]/g, '"').replace(/[–—]/g, '-');
  
  // 3. Keep standard ASCII (32-126), tabs, newlines, and carriage returns
  // This removes emojis and any remaining non-ASCII characters
  content = content.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Cleaned: ${file}`);
  }
});
