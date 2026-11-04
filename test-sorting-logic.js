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
            return (b.started_at || '').localeCompare(a.started_at || '');
        } else if (sortOrder === 'date-asc') {
            return (a.started_at || '').localeCompare(b.started_at || '');
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
console.log('SUMMARY');
console.log('='.repeat(80));

const allTestsPassed = 
    newAsc.map(r => r.started_at.slice(0, 10)).join(' → ') === '2024-01-01 → 2024-01-02 → 2024-01-03' &&
    newDesc.map(r => r.started_at.slice(0, 10)).join(' → ') === '2024-01-03 → 2024-01-02 → 2024-01-01';

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
