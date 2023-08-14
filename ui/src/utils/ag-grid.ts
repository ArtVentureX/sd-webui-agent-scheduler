import { CellFocusedParams, FocusService, GridApi, IRowNode, RowHighlightPosition } from 'ag-grid-community';

// patches to suppress scrolling when mouse down on a cell by default
const setFocusedCell = FocusService.prototype.setFocusedCell;
FocusService.prototype.setFocusedCell = function (params: CellFocusedParams) {
  if (params.preventScrollOnBrowserFocus == null) {
    params.preventScrollOnBrowserFocus = true;
  }
  setFocusedCell.call(this, params);
};

export const getRowNodeAtPixel = <TData = any>(api: GridApi<TData>, pixel: number) => {
  if (api.getDisplayedRowCount() <= 0) return;

  const firstRowIndexOfPage = api.paginationGetPageSize() * api.paginationGetCurrentPage();
  const firstRowNodeOfPage = api.getDisplayedRowAtIndex(firstRowIndexOfPage)!;
  const rowTopOfPage = firstRowNodeOfPage.rowTop!;

  const lastRowIndexOfPage = Math.min(
    api.paginationGetPageSize() * (api.paginationGetCurrentPage() + 1) - 1,
    api.getDisplayedRowCount() - 1
  );
  const lastRowNodeOfPage = api.getDisplayedRowAtIndex(lastRowIndexOfPage)!;
  const rowBottomOfPage = lastRowNodeOfPage.rowTop! + lastRowNodeOfPage.rowHeight!;

  let rowNode: IRowNode<TData> | undefined;
  api.forEachNodeAfterFilterAndSort(node => {
    const rowTop = node.rowTop!, rowHeight = node.rowHeight!;
    if (rowTop < rowBottomOfPage) {
      const pixelOnRow = pixel - (rowTop - rowTopOfPage);
      if (pixelOnRow > 0 && pixelOnRow < rowHeight) {
        rowNode = node;
      }
    }
  });
  return rowNode;
};

export const getPixelOnRow = <TData = any>(api: GridApi<TData>, rowNode: IRowNode<TData>, pixel: number) => {
  const firstRowIndexOfPage = api.paginationGetPageSize() * api.paginationGetCurrentPage();
  const firstRowNodeOfPage = api.getDisplayedRowAtIndex(firstRowIndexOfPage)!;
  const pageFirstRowTop = firstRowNodeOfPage.rowTop!;
  return pixel - (rowNode.rowTop! - pageFirstRowTop);
};

export const getHighlightPosition = <TData = any>(api: GridApi<TData>, rowNode: IRowNode<TData>, pixel: number) => {
  const pixelOnRow = getPixelOnRow(api, rowNode, pixel);
  return pixelOnRow < rowNode.rowHeight! / 2 ? RowHighlightPosition.Above : RowHighlightPosition.Below;
};
