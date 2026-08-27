#!/usr/bin/env node
// Usage: node hash-jar.js path/to/tpatools.jar
// Prints the SHA-256 of a jar so you can register it with /addhash right
// after you build/ship it. Run this against the exact file you're about to
// distribute -- the hash has to match byte-for-byte what players receive.

const crypto = require('crypto');
const fs = require('fs');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node hash-jar.js path/to/tpatools.jar');
  process.exit(1);
}

const hash = crypto.createHash('sha256');
hash.update(fs.readFileSync(filePath));
console.log(hash.digest('hex'));
