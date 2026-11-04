# Sorting Fix Summary: Recent Runs Dashboard

## Problem
The "sort by run date" feature on the Crucible recent runs dashboard was not working correctly for "Oldest first" sorting. The sorting was inverted - selecting "Oldest first" would show newest runs first, and vice versa.

## Root Cause
In `assets/js/crucible-run.js`, the `sortRuns()` function had inverted comparison logic for date sorting:

```javascript
// BEFORE (BUGGY)
case 'date-desc':
  return (b.started_at || '') > (a.started_at || '') ? 1 : -1;
case 'date-asc':
  return (a.started_at || '') < (b.started_at || '') ? 1 : -1;
```

The ternary operators were returning the wrong values:
- When `b.started_at > a.started_at`, it returned `1`, meaning "b should come AFTER a" (wrong for descending)
- When `a.started_at < b.started_at`, it returned `1`, meaning "a should come AFTER b" (wrong for ascending)

## Solution
Changed to use `localeCompare()` for reliable string comparison of ISO date strings:

```javascript
// AFTER (FIXED)
case 'date-desc':
  return (b.started_at || '').localeCompare(a.started_at || '');
case 'date-asc':
  return (a.started_at || '').localeCompare(b.started_at || '');
```

## Files Changed
- `assets/js/crucible-run.js` (lines 118-119)

## Verification

### Test Results
✅ **All tests passed**

1. **Oldest First (date-asc)**: Correctly sorts runs from oldest to newest
   - Input: Jan 3, Jan 1, Jan 2
   - Expected: Jan 1, Jan 2, Jan 3
   - Result: Jan 1, Jan 2, Jan 3 ✓

2. **Newest First (date-desc)**: Correctly sorts runs from newest to oldest
   - Input: Jan 3, Jan 1, Jan 2
   - Expected: Jan 3, Jan 2, Jan 1
   - Result: Jan 3, Jan 2, Jan 1 ✓

### Test Files Created
- `test-sorting-logic.js` - Node.js script demonstrating the fix
- `test-sorting.html` - Interactive HTML test page
- `sorting-fix-proof.html` - Visual before/after comparison

Run the test:
```bash
node test-sorting-logic.js
```

## Pull Request
- **Repository**: schaferandrew/schaferandrew.github.io
- **PR Number**: #42
- **Branch**: fix/sort-by-date-oldest
- **URL**: https://github.com/schaferandrew/schaferandrew.github.io/pull/42

## Screenshots / Proof
The following files demonstrate the fix:
1. `sorting-fix-proof.html` - Visual HTML page showing before/after behavior
2. `test-sorting.html` - Interactive test page that can be opened in a browser
3. `test-sorting-logic.js` - Command-line test that outputs verification results

To view the proof:
- Open `sorting-fix-proof.html` in any web browser
- Open `test-sorting.html` in any web browser
- Run `node test-sorting-logic.js` in a terminal

## Impact
- Users can now correctly sort runs by date in both ascending and descending order
- The dashboard's "Oldest first" option now works as expected
- The dashboard's "Newest first" option continues to work correctly (was also fixed)
