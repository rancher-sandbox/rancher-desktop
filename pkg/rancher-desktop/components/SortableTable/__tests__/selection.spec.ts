/** @jest-environment node */

import { jest } from '@jest/globals';

import selectionMixin from '@pkg/components/SortableTable/selection.js';

const { update } = (selectionMixin as any).methods;
const pagedRowsWatcher = (selectionMixin as any).watch.pagedRows;

/** Minimal `this` context for exercising the selection mixin in isolation. */
function makeContext(overrides: any = {}) {
  return {
    keyField:     'id',
    selectedRows: [],
    pagedRows:    [],
    updateInput:  jest.fn(),
    $emit:        jest.fn(),
    $nextTick:    (cb: () => void) => cb(),
    ...overrides,
  };
}

describe('SortableTable selection mixin', () => {
  describe('update()', () => {
    it('does not add rows that are already selected (dedupe by keyField)', () => {
      const a = { id: 'a' };
      const b = { id: 'b' };
      const ctx = makeContext({ selectedRows: [] });

      update.call(ctx, [a], []);
      // Re-adding `a` alongside a new `b` must not duplicate `a`.
      update.call(ctx, [a, b], []);

      expect(ctx.selectedRows.map((r: any) => r.id)).toEqual(['a', 'b']);
    });

    it('removes rows by keyField even across differing object identities', () => {
      const a = { id: 'a' };
      const ctx = makeContext({ selectedRows: [a] });

      update.call(ctx, [], [{ id: 'a' }]); // different object, same key

      expect(ctx.selectedRows).toHaveLength(0);
    });
  });

  describe('pagedRows watcher (re-bind)', () => {
    it('re-binds surviving selections to the current row objects and drops missing ones', () => {
      const stale = { id: 'a', stale: true };
      const current = { id: 'a', stale: false };
      const gone = { id: 'z' };
      const ctx = makeContext({
        selectedRows: [stale, gone],
        pagedRows:    [current],
      });

      pagedRowsWatcher.call(ctx);

      expect(ctx.selectedRows).toEqual([current]);
      expect(ctx.selectedRows[0]).toBe(current); // identity re-bound, not the stale object
      expect(ctx.$emit).toHaveBeenCalledWith('selection', ctx.selectedRows);
    });

    it('does nothing when the selection already references the current rows', () => {
      const row = { id: 'a' };
      const ctx = makeContext({ selectedRows: [row], pagedRows: [row] });

      pagedRowsWatcher.call(ctx);

      expect(ctx.$emit).not.toHaveBeenCalled();
    });
  });
});
