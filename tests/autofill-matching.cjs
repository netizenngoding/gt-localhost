const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');const sandbox={};vm.createContext(sandbox);vm.runInContext(fs.readFileSync('public/WebLoaderData/MagnoliaAutofill.js','utf8'),sandbox);
const find=sandbox.MagnoliaAutofillMatch;
assert.equal(find('/')[0][0],'help');assert.equal(find('/fi')[0][0],'find');assert.equal(find('/rAn')[0][0],'rank');assert.equal(find('hello').length,0);assert.equal(find('/find dirt').length,0);assert.ok(find('/').length<=6);
console.log('PASS: matching, priority, command-only suggestions and limit');
