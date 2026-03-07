/* eslint-disable no-undef */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();

function readJson(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function compareField(fieldName, packageJson, packageLockRoot) {
  const packageValue = packageJson[fieldName] ?? null;
  const lockValue = packageLockRoot[fieldName] ?? null;

  if (JSON.stringify(packageValue) !== JSON.stringify(lockValue)) {
    fail(
      `package-lock.json is out of sync for "${fieldName}". Run npm install to regenerate the lockfile.`,
    );
  }
}

const packageJson = readJson('package.json');
const serverJson = readJson('server.json');
const packageLock = readJson('package-lock.json');
const packageLockRoot = packageLock.packages?.[''];

if (!packageLockRoot) {
  fail('package-lock.json is missing the root package entry.');
}

if (packageJson.version !== serverJson.version) {
  fail(
    `Version mismatch: package.json has "${packageJson.version}" but server.json has "${serverJson.version}".`,
  );
}

if (packageJson.name !== packageLock.name) {
  fail(
    `package-lock.json has name "${packageLock.name}" but package.json has "${packageJson.name}". Run npm install to regenerate the lockfile.`,
  );
}

if (packageJson.version !== packageLock.version) {
  fail(
    `package-lock.json has version "${packageLock.version}" but package.json has "${packageJson.version}". Run npm install to regenerate the lockfile.`,
  );
}

if (packageLockRoot) {
  const fieldsToCompare = [
    'name',
    'version',
    'bin',
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
    'engines',
  ];

  for (const fieldName of fieldsToCompare) {
    compareField(fieldName, packageJson, packageLockRoot);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
