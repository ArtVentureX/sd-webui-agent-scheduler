import {
  CellClassParams,
  CellClickedEvent,
  createGrid,
  GridApi,
  GridOptions,
  ICellRendererParams,
  ITooltipParams,
  RowHighlightPosition,
  RowNode,
  ValueFormatterParams,
  ValueGetterParams,
} from 'ag-grid-community';
import { Notyf } from 'notyf';

import bookmark from '../assets/icons/bookmark.svg?raw';
import bookmarked from '../assets/icons/bookmark-filled.svg?raw';
import cancelIcon from '../assets/icons/cancel.svg?raw';
import deleteIcon from '../assets/icons/delete.svg?raw';
import playIcon from '../assets/icons/play.svg?raw';
import rotateIcon from '../assets/icons/rotate.svg?raw';
import saveIcon from '../assets/icons/save.svg?raw';
import searchIcon from '../assets/icons/search.svg?raw';
import { getHighlightPosition, getPixelOnRow, getRowNodeAtPixel } from '../utils/ag-grid';
import { debounce } from '../utils/debounce';
import { extractArgs } from '../utils/extract-args';

import { createHistoryTasksStore } from './stores/history.store';
import { createPendingTasksStore } from './stores/pending.store';
import { createSharedStore } from './stores/shared.store';
import { ProgressResponse, ResponseStatus, Task, TaskStatus } from './types';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import 'notyf/notyf.min.css';
import './index.scss';

let notyf: Notyf | undefined;

declare global {
  let opts: object;
  function gradioApp(): HTMLElement;
  function randomId(): string;
  function origRandomId(): string;
  function get_tab_index(name: string): number;
  function create_submit_args(args: any[]): any[];
  function requestProgress(
    id: string,
    progressContainer: HTMLElement,
    imagesContainer: HTMLElement,
    onDone?: () => void,
    onProgress?: (res: ProgressResponse) => void
  ): void;
  function onUiLoaded(callback: () => void): void;
  function notify(response: ResponseStatus): void;
  function submit(...args: any[]): any[];
  function submit_txt2img(...args: any[]): any[];
  function submit_img2img(...args: any[]): any[];
  function submit_enqueue(...args: any[]): any[];
  function submit_enqueue_img2img(...args: any[]): any[];
  function agent_scheduler_hysli_status_filter_changed(value: string): void;
  function appendContextMenuOption(selector: string, label: string, callback: () => void): void;
  function modalSaveImage(event: Event): void;
}

const sharedStore = createSharedStore({
  uiAsTab: true,
  selectedTab: 'pending',
});

const pendingStore = createPendingTasksStore({
  current_task_id: null,
  total_pending_tasks: 0,
  pending_tasks: [],
  paused: false,
});

const historyStore = createHistoryTasksStore({
  total: 0,
  tasks: [],
});

// load samplers and checkpoints
const samplers: string[] = [];
const checkpoints: string[] = ['System'];

const sharedGridOptions: GridOptions<Task> = {
  // default col def properties get applied to all columns
  defaultColDef: {
    sortable: false,
    filter: true,
    resizable: true,
    suppressMenu: true,
  },
  // each entry here represents one column
  columnDefs: [
    {
      field: 'name',
      headerName: 'Task Id',
      cellDataType: 'text',
      minWidth: 240,
      maxWidth: 240,
      pinned: 'left',
      rowDrag: true,
      valueGetter: ({ data }: ValueGetterParams<Task, string>) => data?.name ?? data?.id,
      cellClass: ({ data }: CellClassParams<Task, string>) => {
        if (data == null) return;

        return ['cursor-pointer', `task-${data.status}`];
      },
    },
    {
      field: 'type',
      headerName: 'Type',
      minWidth: 80,
      maxWidth: 80,
      editable: false,
    },
    {
      field: 'editing',
      editable: false,
      hide: true,
    },
    {
      headerName: 'Params',
      children: [
        {
          field: 'params.prompt',
          headerName: 'Prompt',
          cellDataType: 'text',
          minWidth: 200,
          maxWidth: 400,
          autoHeight: true,
          wrapText: true,
          cellClass: 'wrap-cell',
        },
        {
          field: 'params.negative_prompt',
          headerName: 'Negative Prompt',
          cellDataType: 'text',
          minWidth: 200,
          maxWidth: 400,
          autoHeight: true,
          wrapText: true,
          cellClass: 'wrap-cell',
        },
        {
          field: 'params.checkpoint',
          headerName: 'Checkpoint',
          cellDataType: 'text',
          minWidth: 150,
          maxWidth: 300,
          valueFormatter: ({ value }: ValueFormatterParams<Task, string | undefined>) =>
            value ?? 'System',
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: () => ({ values: checkpoints }),
        },
        {
          field: 'params.sampler_name',
          headerName: 'Sampler',
          cellDataType: 'text',
          width: 150,
          minWidth: 150,
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: () => ({ values: samplers }),
        },
        {
          field: 'params.steps',
          headerName: 'Steps',
          cellDataType: 'number',
          minWidth: 80,
          maxWidth: 80,
          filter: 'agNumberColumnFilter',
          cellEditor: 'agNumberCellEditor',
          cellEditorParams: {
            min: 1,
            max: 150,
            precision: 0,
            step: 1,
          },
        },
        {
          field: 'params.cfg_scale',
          headerName: 'CFG Scale',
          cellDataType: 'number',
          width: 100,
          minWidth: 100,
          filter: 'agNumberColumnFilter',
          cellEditor: 'agNumberCellEditor',
          cellEditorParams: {
            min: 1,
            max: 30,
            precision: 1,
            step: 0.5,
          },
        },
        {
          field: 'params.size',
          headerName: 'Size',
          minWidth: 110,
          maxWidth: 110,
          editable: false,
          valueGetter: ({ data }: ValueGetterParams<Task, string | undefined>) => {
            const params = data?.params;
            return params != null ? `${params.width} × ${params.height}` : undefined;
          },
        },
        {
          field: 'params.batch',
          headerName: 'Batching',
          minWidth: 100,
          maxWidth: 100,
          editable: false,
          valueGetter: ({ data }: ValueGetterParams<Task, string>) => {
            const params = data?.params;
            return params != null ? `${params.batch_size} × ${params.n_iter}` : '1 × 1';
          },
        },
      ],
    },
    {
      field: 'created_at',
      headerName: 'Queued At',
      minWidth: 180,
      editable: false,
      valueFormatter: ({ value }: ValueFormatterParams<Task, number>) =>
        value != null ? new Date(value).toLocaleString(document.documentElement.lang) : '',
    },
    {
      field: 'updated_at',
      headerName: 'Updated At',
      minWidth: 180,
      editable: false,
      valueFormatter: ({ value }: ValueFormatterParams<Task, number>) =>
        value != null ? new Date(value).toLocaleString(document.documentElement.lang) : '',
    },
  ],

  getRowId: ({ data }) => data.id,
  rowSelection: 'single', // allow rows to be selected
  animateRows: true, // have rows animate to new positions when sorted
  pagination: true,
  paginationAutoPageSize: true,
  suppressCopyRowsToClipboard: true,
  enableBrowserTooltips: true,
};

function initSearchInput(selector: string) {
  const searchContainer = gradioApp().querySelector<HTMLDivElement>(selector);
  if (searchContainer == null) {
    throw new Error(`Search container '${selector}' not found.`);
  }
  const searchInput = searchContainer.getElementsByTagName('input')[0];
  if (searchInput == null) {
    throw new Error('Search input not found.');
  }
  searchInput.classList.add('ts-search-input');

  const searchIconContainer = document.createElement('div');
  searchIconContainer.className = 'ts-search-icon';
  searchIconContainer.innerHTML = searchIcon;
  searchInput.parentElement!.appendChild(searchIconContainer);

  return searchInput;
}

// function initImport(selector: string) {
//   const importContainer = gradioApp().querySelector<HTMLDivElement>(selector);
//   if (importContainer == null) {
//     throw new Error(`Import container '${selector}' not found.`);
//   }
//   const importInput = importContainer.getElementsByTagName('input')[0];
//   if (importInput == null) {
//     throw new Error('Import input not found.');
//   }
//   return importInput;
// }

async function notify(response: ResponseStatus) {
  if (notyf == null) {
    const Notyf = await import('notyf');
    notyf = new Notyf.Notyf({
      position: { x: 'center', y: 'bottom' },
      duration: 3000,
    });
  }

  if (response.success) {
    notyf.success(response.message);
  } else {
    notyf.error(response.message);
  }
}

window.notify = notify;
window.origRandomId = window.randomId;

function showTaskProgress(task_id: string, type: string | undefined, callback: () => void) {
  // delay progress request until the options loaded
  if (Object.keys(opts).length === 0) {
    setTimeout(() => showTaskProgress(task_id, type, callback), 500);
    return;
  }

  const args = extractArgs(requestProgress);

  const gallery = gradioApp().querySelector<HTMLDivElement>(
    '#agent_scheduler_hysli_current_task_images'
  )!;

  // A1111 version
  if (args.includes('progressbarContainer')) {
    requestProgress(task_id, gallery, gallery, callback);
  } else {
    // Vlad version
    const progressDiv = document.createElement('div');
    progressDiv.className = 'progressDiv';
    gallery.parentElement!.insertBefore(progressDiv, gallery);
    requestProgress(
      task_id,
      gallery,
      gallery,
      () => {
        progressDiv.remove();
        callback();
      },
      res => {
        const perc = `${Math.round(res.progress * 100.0)}%`;
        const eta = res.paused ? 'Paused' : `ETA: ${Math.round(res.eta)}s`;
        progressDiv.innerText = `${perc} ${eta}`;
        progressDiv.style.background = `linear-gradient(to right, var(--primary-500) 0%, var(--primary-800) ${perc}, var(--neutral-700) ${perc})`;
      }
    );
  }

  // monkey patch randomId to return task_id, then call submit to trigger progress
  window.randomId = () => task_id;
  if (type === 'txt2img') {
    submit();
  } else if (type === 'img2img') {
    submit_img2img();
  }
  window.randomId = window.origRandomId;
}

function initQueueHandler() {
  const getUiCheckpoint = (is_img2img: boolean) => {
    const enqueue_wrapper_model = gradioApp().querySelector<HTMLInputElement>(
      `#${is_img2img ? 'img2img_enqueue_wrapper' : 'txt2img_enqueue_wrapper'} input`
    );
    if (enqueue_wrapper_model != null) {
      const checkpoint = enqueue_wrapper_model.value;
      if (checkpoint === 'Runtime Checkpoint' || checkpoint !== 'Current Checkpoint') {
        return checkpoint;
      }
    }

    const setting_sd_model = gradioApp().querySelector<HTMLInputElement>(
      '#setting_sd_model_checkpoint input'
    );
    return setting_sd_model?.value ?? 'Current Checkpoint';
  };

  const btnEnqueue = gradioApp().querySelector<HTMLButtonElement>('#txt2img_enqueue')!;
  window.submit_enqueue = (...args) => {
    const res = create_submit_args(args);
    res[0] = getUiCheckpoint(false);
    res[1] = randomId();
    window.randomId = window.origRandomId;

    if (btnEnqueue != null) {
      btnEnqueue.innerText = 'Queued';
      setTimeout(() => {
        btnEnqueue.innerText = 'Enqueue';
        if (!sharedStore.getState().uiAsTab) {
          if (sharedStore.getState().selectedTab === 'pending') {
            pendingStore.refresh();
          }
        }
      }, 1000);
    }

    return res;
  };

  const btnImg2ImgEnqueue = gradioApp().querySelector<HTMLButtonElement>('#img2img_enqueue')!;
  window.submit_enqueue_img2img = (...args) => {
    const res = create_submit_args(args);
    res[0] = getUiCheckpoint(true);
    res[1] = randomId();
    res[2] = get_tab_index('mode_img2img');
    window.randomId = window.origRandomId;

    if (btnImg2ImgEnqueue != null) {
      btnImg2ImgEnqueue.innerText = 'Queued';
      setTimeout(() => {
        btnImg2ImgEnqueue.innerText = 'Enqueue';
        if (!sharedStore.getState().uiAsTab) {
          if (sharedStore.getState().selectedTab === 'pending') {
            pendingStore.refresh();
          }
        }
      }, 1000);
    }

    return res;
  };

  // detect queue button placement
  const interrogateCol = gradioApp().querySelector<HTMLDivElement>('.interrogate-col');
  if (interrogateCol != null && interrogateCol.childElementCount > 2) {
    interrogateCol.classList.add('has-queue-button');
  }

  // setup keyboard shortcut
  const setting = gradioApp().querySelector<HTMLTextAreaElement>(
    '#setting_queue_keyboard_shortcut textarea'
  )!;
  if (!setting.value.includes('Disabled')) {
    const parts = setting.value.split('+');
    const code = parts.pop();

    const handleShortcut = (e: KeyboardEvent) => {
      if (e.code !== code) return;
      if (parts.includes('Shift') && !e.shiftKey) return;
      if (parts.includes('Alt') && !e.altKey) return;
      if (parts.includes('Command') && !e.metaKey) return;
      if ((parts.includes('Control') || parts.includes('Ctrl')) && !e.ctrlKey) return;

      e.preventDefault();
      e.stopPropagation();

      const activeTab = get_tab_index('tabs');
      if (activeTab === 0) {
        btnEnqueue.click();
      } else if (activeTab === 1) {
        btnImg2ImgEnqueue.click();
      }
    };

    window.addEventListener('keydown', handleShortcut);

    const txt2imgPrompt = gradioApp().querySelector<HTMLTextAreaElement>(
      '#txt2img_prompt textarea'
    )!;
    txt2imgPrompt.addEventListener('keydown', handleShortcut);

    const img2imgPrompt = gradioApp().querySelector<HTMLTextAreaElement>(
      '#img2img_prompt textarea'
    )!;
    img2imgPrompt.addEventListener('keydown', handleShortcut);
  }

  // watch for current task id change
  pendingStore.subscribe((curr, prev) => {
    const id = curr.current_task_id;
    if (id !== prev.current_task_id && id != null) {
      const task = curr.pending_tasks.find(t => t.id === id);
      showTaskProgress(id, task?.type, pendingStore.refresh);
    }
  });

  // context menu
  const queueWithTaskName = (img2img = false) => {
    const name = prompt('Enter task name');
    window.randomId = () => name ?? window.origRandomId();
    if (img2img) {
      btnImg2ImgEnqueue.click();
    } else {
      btnEnqueue.click();
    }
  };
  const queueWithEveryCheckpoint = (img2img = false) => {
    window.randomId = () => '$$_queue_with_all_checkpoints_$$';
    if (img2img) {
      btnImg2ImgEnqueue.click();
    } else {
      btnEnqueue.click();
    }
  };

  appendContextMenuOption('#txt2img_enqueue', 'Queue with task name', () => queueWithTaskName());
  appendContextMenuOption('#txt2img_enqueue', 'Queue with all checkpoints', () =>
    queueWithEveryCheckpoint()
  );
  appendContextMenuOption('#img2img_enqueue', 'Queue with task name', () =>
    queueWithTaskName(true)
  );
  appendContextMenuOption('#img2img_enqueue', 'Queue with all checkpoints', () =>
    queueWithEveryCheckpoint(true)
  );

  // preview modal save button
  const origModalSaveImage = window.modalSaveImage;
  window.modalSaveImage = (event: Event) => {
    const tab = gradioApp().querySelector<HTMLDivElement>('#tab_agent_scheduler_hysli')!;
    if (tab.style.display !== 'none') {
      gradioApp().querySelector<HTMLButtonElement>('#agent_scheduler_hysli_save')!.click();
      event.preventDefault();
    } else {
      origModalSaveImage(event);
    }
  };
}

function initTabChangeHandler() {
  sharedStore.subscribe((curr, prev) => {
    if (!curr.uiAsTab || curr.selectedTab !== prev.selectedTab) {
      if (curr.selectedTab === 'pending') {
        pendingStore.refresh();
      } else {
        historyStore.refresh();
      }
    }
  });

  // watch for tab activation
  const observer = new MutationObserver(mutationsList => {
    mutationsList.forEach(styleChange => {
      const tab = styleChange.target as HTMLElement;
      const visible = tab.style.display !== 'none';
      if (!visible) return;

      switch (tab.id) {
        case 'tab_agent_scheduler_hysli':
          if (sharedStore.getState().selectedTab === 'pending') {
            pendingStore.refresh();
          } else {
            historyStore.refresh();
          }
          break;
        case 'agent_scheduler_hysli_pending_tasks_tab':
          sharedStore.setSelectedTab('pending');
          break;
        case 'agent_scheduler_hysli_history_tab':
          sharedStore.setSelectedTab('history');
          break;
      }
    });
  });
  const tab = gradioApp().querySelector('#tab_agent_scheduler_hysli');
  if (tab != null) {
    observer.observe(tab, { attributeFilter: ['style'] });
  } else {
    sharedStore.setState({ uiAsTab: false });
  }
  observer.observe(gradioApp().querySelector('#agent_scheduler_hysli_pending_tasks_tab')!, {
    attributeFilter: ['style'],
  });
  observer.observe(gradioApp().querySelector('#agent_scheduler_hysli_history_tab')!, {
    attributeFilter: ['style'],
  });
}

function initPendingTab() {
  const store = pendingStore;

  // load data for edit
  sharedStore.getSamplers().then(res => samplers.push(...res));
  sharedStore.getCheckpoints().then(res => checkpoints.push(...res));

  // init actions
  const refreshButton = gradioApp().querySelector<HTMLButtonElement>(
    '#agent_scheduler_hysli_action_reload'
  )!;
  refreshButton.addEventListener('click', () => store.refresh());

  const pauseButton = gradioApp().querySelector<HTMLButtonElement>(
    '#agent_scheduler_hysli_action_pause'
  )!;
  pauseButton.addEventListener('click', () => store.pauseQueue().then(notify));

  const resumeButton = gradioApp().querySelector<HTMLButtonElement>(
    '#agent_scheduler_hysli_action_resume'
  )!;
  resumeButton.addEventListener('click', () => store.resumeQueue().then(notify));

  const clearButton = gradioApp().querySelector<HTMLButtonElement>(
    '#agent_scheduler_hysli_action_clear_queue'
  )!;
  clearButton.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the queue?')) {
      store.clearQueue().then(notify);
    }
  });

  const importButton = gradioApp().querySelector<HTMLButtonElement>(
    '#agent_scheduler_hysli_action_import'
  )!;
  const importInput = gradioApp().querySelector<HTMLInputElement>(
    '#agent_scheduler_hysli_import_file'
  )!;

  importButton.addEventListener('click', () => {
    importInput.click();
  });
  importInput.addEventListener('change', e => {
    if (e.target === null) return;

    const files = importInput.files;
    if (files == null || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result as string;
      store
        .importQueue(data)
        .then(notify)
        .then(() => {
          importInput.value = '';
          store.refresh();
        });
    };
    reader.readAsText(file);
  });

  const exportButton = gradioApp().querySelector<HTMLButtonElement>(
    '#agent_scheduler_hysli_action_export'
  )!;
  exportButton.addEventListener('click', () => {
    store.exportQueue().then(data => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data));
      const dlAnchorElem = document.createElement('a');
      dlAnchorElem.setAttribute('href', dataStr);
      dlAnchorElem.setAttribute('download', `agent-scheduler-hysli-${Date.now()}.json`);
      dlAnchorElem.click();
    });
  });

  // watch for queue status change
  const updateUiState = (state: ReturnType<typeof store.getState>) => {
    if (state.paused) {
      pauseButton.classList.add('hide', 'hidden');
      resumeButton.classList.remove('hide', 'hidden');
    } else {
      pauseButton.classList.remove('hide', 'hidden');
      resumeButton.classList.add('hide', 'hidden');
    }
  };
  store.subscribe(updateUiState);
  updateUiState(store.getState());

  let lastHighlightedRow: RowNode<Task> | null;

  let pageMoveTimeout: ReturnType<typeof setTimeout> | null;

  const PAGE_MOVE_TIMEOUT_MS = 1.5 * 1000;
  const PAGE_MOVE_Y_MARGIN = 45 / 2; // half of default (min) rowHeight

  const clearPageMoveTimeout = () => {
    if (pageMoveTimeout != null) {
      clearTimeout(pageMoveTimeout);
      pageMoveTimeout = null;
    }
  };
  const updatePageMoveTimeout = (api: GridApi<Task>, pixel: number) => {
    if (lastHighlightedRow == null) {
      clearPageMoveTimeout();
      return;
    }

    const firstRowIndexOfPage = api.paginationGetPageSize() * api.paginationGetCurrentPage();
    const lastRowIndexOfPage = Math.min(
      api.paginationGetPageSize() * (api.paginationGetCurrentPage() + 1) - 1,
      api.getDisplayedRowCount() - 1
    );

    const rowIndex = lastHighlightedRow.rowIndex!;
    if (rowIndex === firstRowIndexOfPage) {
      if (getPixelOnRow(api, lastHighlightedRow, pixel) > PAGE_MOVE_Y_MARGIN) {
        clearPageMoveTimeout();
        return;
      }
      if (pageMoveTimeout == null) {
        pageMoveTimeout = setTimeout(() => {
          if (api.paginationGetCurrentPage() > 0) {
            api.paginationGoToPreviousPage();
            highlightRow(api);
          }
          pageMoveTimeout = null;
        }, PAGE_MOVE_TIMEOUT_MS);
      }
    } else if (rowIndex === lastRowIndexOfPage) {
      if (
        getPixelOnRow(api, lastHighlightedRow, pixel) <
        lastHighlightedRow.rowHeight! - PAGE_MOVE_Y_MARGIN
      ) {
        clearPageMoveTimeout();
        return;
      }
      if (pageMoveTimeout == null) {
        pageMoveTimeout = setTimeout(() => {
          if (api.paginationGetCurrentPage() < api.paginationGetTotalPages() - 1) {
            api.paginationGoToNextPage();
            highlightRow(api);
          }
          pageMoveTimeout = null;
        }, PAGE_MOVE_TIMEOUT_MS);
      }
    }
  };

  let lastPixel: number | null;

  const clearHighlightedRow = () => {
    clearPageMoveTimeout();
    lastPixel = null;
    if (lastHighlightedRow != null) {
      lastHighlightedRow.setHighlighted(null);
      lastHighlightedRow = null;
    }
  };
  const highlightRow = (api: GridApi<Task>, pixel?: number) => {
    if (pixel == null) {
      if (lastPixel == null) return;
      pixel = lastPixel;
    } else {
      lastPixel = pixel;
    }

    const rowNode = getRowNodeAtPixel(api, pixel) as RowNode<Task> | undefined;
    if (rowNode == null) return;

    const highlight = getHighlightPosition(api, rowNode, pixel);
    if (lastHighlightedRow != null && rowNode.id !== lastHighlightedRow.id) {
      clearHighlightedRow();
    }
    rowNode.setHighlighted(highlight);
    lastHighlightedRow = rowNode;
    updatePageMoveTimeout(api, pixel);
  };

  // init grid
  const gridOptions: GridOptions<Task> = {
    ...sharedGridOptions,
    editType: 'fullRow',
    defaultColDef: {
      ...sharedGridOptions.defaultColDef,
      editable: ({ data }) => data?.status === 'pending',
      cellDataType: false,
    },
    // each entry here represents one column
    columnDefs: [
      {
        field: 'priority',
        hide: true,
        sort: 'asc',
      },
      ...sharedGridOptions.columnDefs!,
      {
        headerName: 'Action',
        pinned: 'right',
        minWidth: 110,
        maxWidth: 110,
        resizable: false,
        editable: false,
        valueGetter: ({ data }) => data?.id,
        cellClass: 'pending-actions',
        cellRenderer: ({ api, value, data }: ICellRendererParams<Task, string>) => {
          if (data == null || value == null) return;

          const node = document.createElement('div');
          node.innerHTML = `
          <div class="inline-flex mt-1 edit-actions" role="group">
            <button type="button" title="Save" class="ts-btn-action primary ts-btn-save">
              ${saveIcon}
            </button>
            <button type="button" title="Cancel" class="ts-btn-action secondary ts-btn-cancel">
              ${cancelIcon}
            </button>
          </div>
          <div class="inline-flex mt-1 control-actions" role="group">
            <button type="button" title="Run" class="ts-btn-action primary ts-btn-run"
              ${data.status === 'running' ? 'disabled' : ''}>
              ${playIcon}
            </button>
            <button type="button" title="${data.status === 'pending' ? 'Delete' : 'Interrupt'}"
              class="ts-btn-action stop ts-btn-delete">
              ${data.status === 'pending' ? deleteIcon : cancelIcon}
            </button>
          </div>
          `;

          const btnSave = node.querySelector<HTMLButtonElement>('button.ts-btn-save')!;
          btnSave.addEventListener('click', () => {
            api.showLoadingOverlay();
            pendingStore.updateTask(data.id, data).then(res => {
              notify(res);
              api.hideOverlay();
              api.stopEditing(false);
            });
          });

          const btnCancel = node.querySelector<HTMLButtonElement>('button.ts-btn-cancel')!;
          btnCancel.addEventListener('click', () => api.stopEditing(true));

          const btnRun = node.querySelector<HTMLButtonElement>('button.ts-btn-run')!;
          btnRun.addEventListener('click', () => {
            api.showLoadingOverlay();
            store.runTask(value).then(() => api.hideOverlay());
          });
          const btnDelete = node.querySelector<HTMLButtonElement>('button.ts-btn-delete')!;
          btnDelete.addEventListener('click', () => {
            api.showLoadingOverlay();
            store.deleteTask(value).then(res => {
              notify(res);
              api.applyTransaction({ remove: [data] });
              api.hideOverlay();
            });
          });

          return node;
        },
      },
    ],
    onColumnMoved: ({ api }) => {
      const colState = api.getColumnState();
      const colStateStr = JSON.stringify(colState);
      localStorage.setItem('agent_scheduler_hysli:queue_col_state', colStateStr);
    },
    onSortChanged: ({ api }) => {
      const colState = api.getColumnState();
      const colStateStr = JSON.stringify(colState);
      localStorage.setItem('agent_scheduler_hysli:queue_col_state', colStateStr);
    },
    onColumnResized: ({ api }) => {
      const colState = api.getColumnState();
      const colStateStr = JSON.stringify(colState);
      localStorage.setItem('agent_scheduler_hysli:queue_col_state', colStateStr);
    },
    onGridReady: ({ api }) => {
      // init quick search input
      const searchInput = initSearchInput('#agent_scheduler_hysli_action_search');
      searchInput.addEventListener(
        'keyup',
        debounce(function () {
          api.updateGridOptions({ quickFilterText: this.value });
        }, 200)
      );

      const updateRowData = (state: ReturnType<typeof store.getState>) => {
        api.updateGridOptions({ rowData: state.pending_tasks });

        if (state.current_task_id != null) {
          const node = api.getRowNode(state.current_task_id);
          if (node != null) {
            api.refreshCells({ rowNodes: [node], force: true });
          }
        }

        api.clearFocusedCell();
        api.autoSizeAllColumns();
      };
      store.subscribe(updateRowData);
      updateRowData(store.getState());

      // restore col state
      const colStateStr = localStorage.getItem('agent_scheduler_hysli:queue_col_state');
      if (colStateStr != null) {
        const colState = JSON.parse(colStateStr);
        api.applyColumnState({ state: colState, applyOrder: true });
      }
    },
    onRowDragEnter: ({ api, y }) => highlightRow(api, y),
    onRowDragMove: ({ api, y }) => highlightRow(api, y),
    onRowDragLeave: () => clearHighlightedRow(),
    onRowDragEnd: ({ api, node }) => {
      const highlightedRow = lastHighlightedRow;
      if (highlightedRow == null) {
        clearHighlightedRow();
        return;
      }

      const id = node.data?.id;
      const highlightedId = highlightedRow.data?.id;
      if (id == null || highlightedId == null || id === highlightedId) {
        clearHighlightedRow();
        return;
      }

      let index = -1,
        overIndex = -1;
      const tasks = [...store.getState().pending_tasks].sort((a, b) => a.priority - b.priority);
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].id === id) {
          index = i;
        }
        if (tasks[i].id === highlightedId) {
          overIndex = i;
        }
        if (index !== -1 && overIndex !== -1) {
          break;
        }
      }
      if (index === -1 || overIndex === -1) {
        clearHighlightedRow();
        return;
      }
      if (highlightedRow.highlighted === RowHighlightPosition.Below) {
        overIndex += 1;
      }
      if (overIndex === index || overIndex === index + 1) {
        clearHighlightedRow();
        return;
      }

      const overId = tasks[overIndex]?.id ?? 'bottom';

      api.showLoadingOverlay();
      store.moveTask(id, overId).then(() => {
        clearHighlightedRow();
        api.hideOverlay();
      });
    },
    onRowEditingStarted: ({ api, data, node }) => {
      if (data == null) return;

      node.setDataValue('editing', true);
      api.refreshCells({ rowNodes: [node], force: true });
    },
    onRowEditingStopped: ({ api, data, node }) => {
      if (data == null) return;

      node.setDataValue('editing', false);
      api.refreshCells({ rowNodes: [node], force: true });
    },
    onRowValueChanged: ({ api, data }) => {
      if (data == null) return;

      api.showLoadingOverlay();
      pendingStore.updateTask(data.id, data).then(res => {
        notify(res);
        api.hideOverlay();
      });
    },
  };

  const eGridDiv = gradioApp().querySelector<HTMLDivElement>(
    '#agent_scheduler_hysli_pending_tasks_grid'
  )!;

  if (typeof eGridDiv.dataset.pageSize === 'string') {
    const pageSize = parseInt(eGridDiv.dataset.pageSize, 10);

    if (pageSize > 0) {
      gridOptions.paginationAutoPageSize = false;
      gridOptions.paginationPageSize = pageSize;
    }
  }

  createGrid(eGridDiv, gridOptions);
}

function initHistoryTab() {
  const store = historyStore;

  // init actions
  const refreshButton = gradioApp().querySelector<HTMLButtonElement>(
    '#agent_scheduler_hysli_action_refresh_history'
  )!;
  refreshButton.addEventListener('click', () => store.refresh());
  const clearButton = gradioApp().querySelector<HTMLButtonElement>(
    '#agent_scheduler_hysli_action_clear_history'
  )!;
  clearButton.addEventListener('click', () => {
    if (!confirm('Are you sure you want to clear the history?')) return;
    store.clearHistory().then(notify);
  });
  const requeueButton = gradioApp().querySelector<HTMLButtonElement>(
    '#agent_scheduler_hysli_action_requeue'
  )!;
  requeueButton.addEventListener('click', () => {
    store.requeueFailedTasks().then(notify);
  });

  const resultTaskId = gradioApp().querySelector<HTMLTextAreaElement>(
    '#agent_scheduler_hysli_history_selected_task textarea'
  )!;
  const resultImageId = gradioApp().querySelector<HTMLTextAreaElement>(
    '#agent_scheduler_hysli_history_selected_image textarea'
  )!;
  const resultGallery = gradioApp().querySelector<HTMLDivElement>(
    '#agent_scheduler_hysli_history_gallery'
  )!;
  resultGallery.addEventListener('click', e => {
    const target = e.target as Element | null;
    if (target?.tagName === 'IMG') {
      const imageIdx = Array.prototype.indexOf.call(
        target.parentElement!.parentElement!.children,
        target.parentElement!
      );
      resultImageId.value = imageIdx.toString();
      resultImageId.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  window.agent_scheduler_hysli_status_filter_changed = value => {
    store.onFilterStatus(value?.toLowerCase() as TaskStatus | undefined);
  };

  // init grid
  const gridOptions: GridOptions<Task> = {
    ...sharedGridOptions,
    readOnlyEdit: true,
    defaultColDef: {
      ...sharedGridOptions.defaultColDef,
      sortable: true,
      editable: ({ colDef }) => colDef?.field === 'name',
    },
    // each entry here represents one column
    columnDefs: [
      {
        headerName: '',
        field: 'bookmarked',
        minWidth: 55,
        maxWidth: 55,
        pinned: 'left',
        sort: 'desc',
        tooltipValueGetter: ({ value }: ITooltipParams<Task, boolean | undefined, any>) =>
          value === true ? 'Unbookmark' : 'Bookmark',
        cellClass: ({ value }: CellClassParams<Task, boolean | undefined>) => [
          'cursor-pointer',
          'pt-3',
          value === true ? 'ts-bookmarked' : 'ts-bookmark',
        ],
        cellRenderer: ({ value }: ICellRendererParams<Task, boolean | undefined>) =>
          value === true ? bookmarked : bookmark,
        onCellClicked: ({
          api,
          data,
          value,
          event,
        }: CellClickedEvent<Task, boolean | undefined>) => {
          if (data == null) return;

          if (event != null) {
            event.stopPropagation();
            event.preventDefault();
          }

          const bookmarked = value === true;
          store.bookmarkTask(data.id, !bookmarked).then(res => {
            notify(res);
            api.applyTransaction({
              update: [{ ...data, bookmarked: !bookmarked }],
            });
          });
        },
      },
      {
        field: 'priority',
        hide: true,
        sort: 'desc',
      },
      {
        ...sharedGridOptions.columnDefs![0],
        rowDrag: false,
      },
      ...sharedGridOptions.columnDefs!.slice(1),
      {
        headerName: 'Action',
        pinned: 'right',
        minWidth: 110,
        maxWidth: 110,
        resizable: false,
        valueGetter: ({ data }) => data?.id,
        cellRenderer: ({ api, data, value }: ICellRendererParams<Task, string | undefined>) => {
          if (data == null || value == null) return;

          const node = document.createElement('div');
          node.innerHTML = `
          <div class="inline-flex mt-1" role="group">
            <button type="button" title="Requeue" class="ts-btn-action primary ts-btn-run">
              ${rotateIcon}
            </button>
            <button type="button" title="Delete" class="ts-btn-action stop ts-btn-delete">
              ${deleteIcon}
            </button>
          </div>
          `;

          const btnRun = node.querySelector<HTMLButtonElement>('button.ts-btn-run')!;
          btnRun.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            store.requeueTask(value).then(notify);
          });
          const btnDelete = node.querySelector<HTMLButtonElement>('button.ts-btn-delete')!;
          btnDelete.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            api.showLoadingOverlay();
            pendingStore.deleteTask(value).then(res => {
              notify(res);
              api.applyTransaction({ remove: [data] });
              api.hideOverlay();
            });
          });

          return node;
        },
      },
    ],
    rowSelection: 'single',
    suppressRowDeselection: true,
    onColumnMoved: ({ api }) => {
      const colState = api.getColumnState();
      const colStateStr = JSON.stringify(colState);
      localStorage.setItem('agent_scheduler_hysli:history_col_state', colStateStr);
    },
    onSortChanged: ({ api }) => {
      const colState = api.getColumnState();
      const colStateStr = JSON.stringify(colState);
      localStorage.setItem('agent_scheduler_hysli:history_col_state', colStateStr);
    },
    onColumnResized: ({ api }) => {
      const colState = api.getColumnState();
      const colStateStr = JSON.stringify(colState);
      localStorage.setItem('agent_scheduler_hysli:history_col_state', colStateStr);
    },
    onGridReady: ({ api }) => {
      // init quick search input
      const searchInput = initSearchInput('#agent_scheduler_hysli_action_search_history');
      searchInput.addEventListener(
        'keyup',
        debounce(function () {
          api.updateGridOptions({ quickFilterText: this.value });
        }, 200)
      );

      const updateRowData = (state: ReturnType<typeof store.getState>) => {
        api.updateGridOptions({ rowData: state.tasks });
        api.clearFocusedCell();
        api.autoSizeAllColumns();
      };
      store.subscribe(updateRowData);
      updateRowData(store.getState());

      // restore col state
      const colStateStr = localStorage.getItem('agent_scheduler_hysli:history_col_state');
      if (colStateStr != null) {
        const colState = JSON.parse(colStateStr);
        api.applyColumnState({ state: colState, applyOrder: true });
      }
    },
    onSelectionChanged: ({ api }) => {
      const [selected] = api.getSelectedRows();
      resultTaskId.value = selected.id;
      resultTaskId.dispatchEvent(new Event('input', { bubbles: true }));
    },
    onCellEditRequest: ({ api, data, colDef, newValue }) => {
      if (colDef.field !== 'name') return;

      const name = newValue as string | undefined;
      if (name == null) return;

      api.showLoadingOverlay();
      historyStore.renameTask(data.id, name).then(res => {
        notify(res);
        const newData = { ...data, name };
        api.applyTransaction({ update: [newData] });
        api.hideOverlay();
      });
    },
  };
  const eGridDiv = gradioApp().querySelector<HTMLDivElement>(
    '#agent_scheduler_hysli_history_tasks_grid'
  )!;

  if (typeof eGridDiv.dataset.pageSize === 'string') {
    const pageSize = parseInt(eGridDiv.dataset.pageSize, 10);

    if (pageSize > 0) {
      gridOptions.paginationAutoPageSize = false;
      gridOptions.paginationPageSize = pageSize;
    }
  }

  createGrid(eGridDiv, gridOptions);
}

let AgentSchedulerHysliInitialized = false;
onUiLoaded(function initAgentSchedulerHysli() {
  // delay ui init until dom is available
  if (gradioApp().querySelector('#agent_scheduler_hysli_tabs') == null) {
    setTimeout(initAgentSchedulerHysli, 500);
    return;
  }

  if (AgentSchedulerHysliInitialized) return;
  initQueueHandler();
  initTabChangeHandler();
  initPendingTab();
  initHistoryTab();
  AgentSchedulerHysliInitialized = true;
});
