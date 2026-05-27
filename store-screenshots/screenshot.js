const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const dir = __dirname;

const slides = [
  'slide1', 'slide1_ja',
  'slide2', 'slide2_ja',
  'slide3', 'slide3_ja',
  'slide4', 'slide4_ja',
  'slide5', 'slide5_ja',
];

for (const slide of slides) {
  const input = path.join(dir, `${slide}.html`);
  const output = path.join(dir, `${slide}.png`);
  const url = `file:///${input.replace(/\\/g, '/')}`;
  console.log(`Capturing ${slide}...`);
  execSync(
    `"${chrome}" --headless=new --disable-gpu --window-size=1280,800 --screenshot="${output}" "${url}"`,
    { stdio: 'inherit' }
  );
  console.log(`  -> ${output}`);
}

console.log('Done.');
