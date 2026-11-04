/**
 * Test script to verify the date sorting fix
 * This demonstrates that the fix correctly sorts runs by date
 */

// Simulate the OLD (buggy) sorting logic
function sortRunsOld(runs, sortOrder) {
    return runs.slice().sort(function(a, b) {
        if (sortOrder === 'date-desc') {
            // BUG: This is inverted - returns 1 when b > a, meaning b comes after a
            return (b.started_at || '') > (a.started_at || '') ? 1 : -1;
        } else if (sortOrder === 'date-asc') {
            // BUG: This is inverted - returns 1 when a < b, meaning a comes after b
            return (a.started_at || '') < (b.started_at || '') ? 1 : -1;
        }
        return 0;
    });
}

// Simulate the NEW (fixed) sorting logic
function sortRunsNew(runs, sortOrder) {
    return runs.slice().sort(function(a, b) {
        if (sortOrder === 'date-desc') {
            if (!a.started_at && !b.started_at) return 0;
            if (!a.started_at) return 1;
            if (!b.started_at) return -1;
            return b.started_at.localeCompare(a.started_at);
        } else if (sortOrder === 'date-asc') {
            if (!a.started_at && !b.started_at) return 0;
            if (!a.started_at) return 1;
            if (!b.started_at) return -1;
            return a.started_at.localeCompare(b.started_at);
        }
        return 0;
    });
}

// Test data
const testRuns = [
    { run_uuid: 'run-c', started_at: '2024-01-03T10:00:00Z' },
    { run_uuid: 'run-a', started_at: '2024-01-01T10:00:00Z' },
    { run_uuid: 'run-b', started_at: '2024-01-02T10:00:00Z' }
];

// Test data with null dates
const testRunsWithNulls = [
    { run_uuid: 'run-c', started_at: '2024-01-03T10:00:00Z' },
    { run_uuid: 'run-a', started_at: '2024-01-01T10:00:00Z' },
    { run_uuid: 'run-null-1', started_at: null },
    { run_uuid: 'run-b', started_at: '2024-01-02T10:00:00Z' },
    { run_uuid: 'run-null-2', started_at: undefined }
];

console.log('='.repeat(80));
console.log('DATE SORTING FIX VERIFICATION');
console.log('='.repeat(80));
console.log();

// Test 1: Oldest First
console.log('TEST 1: Oldest First (date-asc)');
console.log('-'.repeat(80));

const oldAsc = sortRunsOld(testRuns, 'date-asc');
const newAsc = sortRunsNew(testRuns, 'date-asc');

console.log('Original order: run-c (Jan 3), run-a (Jan 1), run-b (Jan 2)');
console.log();
console.log('OLD (buggy) sorting:');
oldAsc.forEach(r => console.log(`  - ${r.run_uuid}: ${r.started_at.slice(0, 10)}`));
console.log(`  Result: ${oldAsc.map(r => r.started_at.slice(0, 10)).join(' → ')}`);
console.log(`  Expected: 2024-01-01 → 2024-01-02 → 2024-01-03`);
console.log(`  Status: ${oldAsc.map(r => r.started_at.slice(0, 10)).join(' → ') === '2024-01-01 → 2024-01-02 → 2024-01-03' ? '✓ PASS' : '✗ FAIL'}`);
console.log();

console.log('NEW (fixed) sorting:');
newAsc.forEach(r => console.log(`  - ${r.run_uuid}: ${r.started_at.slice(0, 10)}`));
console.log(`  Result: ${newAsc.map(r => r.started_at.slice(0, 10)).join(' → ')}`);
console.log(`  Expected: 2024-01-01 → 2024-01-02 → 2024-01-03`);
console.log(`  Status: ${newAsc.map(r => r.started_at.slice(0, 10)).join(' → ') === '2024-01-01 → 2024-01-02 → 2024-01-03' ? '✓ PASS' : '✗ FAIL'}`);
console.log();

// Test 2: Newest First
console.log('TEST 2: Newest First (date-desc)');
console.log('-'.repeat(80));

const oldDesc = sortRunsOld(testRuns, 'date-desc');
const newDesc = sortRunsNew(testRuns, 'date-desc');

console.log('Original order: run-c (Jan 3), run-a (Jan 1), run-b (Jan 2)');
console.log();
console.log('OLD (buggy) sorting:');
oldDesc.forEach(r => console.log(`  - ${r.run_uuid}: ${r.started_at.slice(0, 10)}`));
console.log(`  Result: ${oldDesc.map(r => r.started_at.slice(0, 10)).join(' → ')}`);
console.log(`  Expected: 2024-01-03 → 2024-01-02 → 2024-01-01`);
console.log(`  Status: ${oldDesc.map(r => r.started_at.slice(0, 10)).join(' → ') === '2024-01-03 → 2024-01-02 → 2024-01-01' ? '✓ PASS' : '✗ FAIL'}`);
console.log();

console.log('NEW (fixed) sorting:');
newDesc.forEach(r => console.log(`  - ${r.run_uuid}: ${r.started_at.slice(0, 10)}`));
console.log(`  Result: ${newDesc.map(r => r.started_at.slice(0, 10)).join(' → ')}`);
console.log(`  Expected: 2024-01-03 → 2024-01-02 → 2024-01-01`);
console.log(`  Status: ${newDesc.map(r => r.started_at.slice(0, 10)).join(' → ') === '2024-01-03 → 2024-01-02 → 2024-01-01' ? '✓ PASS' : '✗ FAIL'}`);
console.log();

// Summary
console.log('='.repeat(80));
console.log('TEST 3: Oldest First with Null Dates');
console.log('-'.repeat(80));

const oldAscNulls = sortRunsOld(testRunsWithNulls, 'date-asc');
const newAscNulls = sortRunsNew(testRunsWithNulls, 'date-asc');

console.log('Original order: run-c (Jan 3), run-a (Jan 1), run-null-1 (null), run-b (Jan 2), run-null-2 (undefined)');
console.log();
console.log('OLD (buggy) sorting:');
oldAscNulls.forEach(r => console.log(`  - ${r.run_uuid}: ${r.started_at ? r.started_at.slice(0, 10) : 'null'}`));
console.log();

console.log('NEW (fixed) sorting:');
newAscNulls.forEach(r => console.log(`  - ${r.run_uuid}: ${r.started_at ? r.started_at.slice(0, 10) : 'null'}`));
const nullsAtEndAsc = newAscNulls.slice(-2).every(r => !r.started_at);
console.log(`  Nulls at end: ${nullsAtEndAsc ? '✓ PASS' : '✗ FAIL'}`);
console.log();

console.log('TEST 4: Newest First with Null Dates');
console.log('-'.repeat(80));

const oldDescNulls = sortRunsOld(testRunsWithNulls, 'date-desc');
const newDescNulls = sortRunsNew(testRunsWithNulls, 'date-desc');

console.log('NEW (fixed) sorting:');
newDescNulls.forEach(r => console.log(`  - ${r.run_uuid}: ${r.started_at ? r.started_at.slice(0, 10) : 'null'}`));
const nullsAtEndDesc = newDescNulls.slice(-2).every(r => !r.started_at);
console.log(`  Nulls at end: ${nullsAtEndDesc ? '✓ PASS' : '✗ FAIL'}`);
console.log();

console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));

const allTestsPassed = 
    newAsc.map(r => r.started_at.slice(0, 10)).join(' → ') === '2024-01-01 → 2024-01-02 → 2024-01-03' &&
    newDesc.map(r => r.started_at.slice(0, 10)).join(' → ') === '2024-01-03 → 2024-01-02 → 2024-01-01' &&
    nullsAtEndAsc &&
    nullsAtEndDesc;

if (allTestsPassed) {
    console.log('✓ ALL TESTS PASSED - The fix works correctly!');
} else {
    console.log('✗ SOME TESTS FAILED');
}
console.log();
console.log('The bug was in the comparison logic:');
console.log('  - OLD: Used > and < operators with ternary returning 1 or -1 (inverted)');
console.log('  - NEW: Uses localeCompare() for reliable string comparison');
console.log();
console.log('File changed: assets/js/crucible-run.js (lines 118-119)');
console.log('PR: https://github.com/schaferandrew/schaferandrew.github.io/pull/42');
