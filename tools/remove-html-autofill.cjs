// Remove the two files installed by patch v5; no other files are touched.
const fs=require('node:fs');
const path=require('node:path');
for(const relative of ['public/WebLoaderData/MagnoliaAutofill.js','tests/autofill-matching.cjs']) {
  const file=path.resolve(process.cwd(),relative);
  try {fs.unlinkSync(file);console.log('Dihapus:',relative)}
  catch(error) {if(error.code==='ENOENT') console.log('Tidak ada:',relative);else throw error;}
}
console.log('Selesai. Restart server dan refresh browser.');
