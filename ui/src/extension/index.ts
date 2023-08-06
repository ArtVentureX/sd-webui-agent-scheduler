/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { Grid, GridOptions } from 'ag-grid-community';
import { Notyf } from 'notyf';

import bookmark from '../assets/icons/bookmark.svg?raw';
import bookmarked from '../assets/icons/bookmark-filled.svg?raw';
import cancelIcon from '../assets/icons/cancel.svg?raw';
import deleteIcon from '../assets/icons/delete.svg?raw';
import playIcon from '../assets/icons/play.svg?raw';
import rotateIcon from '../assets/icons/rotate.svg?raw';
import saveIcon from '../assets/icons/save.svg?raw';
import searchIcon from '../assets/icons/search.svg?raw';
import { debounce } from '../utils/debounce';
import { extractArgs } from '../utils/extract-args';
import { formatDate } from '../utils/format-date';

import { createHistoryTasksStore } from './stores/history.store';
import { createPendingTasksStore } from './stores/pending.store';
import { createSharedStore } from './stores/shared.store';
import { ProgressResponse, ResponseStatus, Task, TaskStatus } from './types';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import 'notyf/notyf.min.css';
import './index.scss';

let notyf: Notyf;

declare global {
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
    onProgress?: (res: ProgressResponse) => void,
  ): void;
  function onUiLoaded(callback: () => void): void;
  function notify(response: ResponseStatus): void;
  function submit(...args: any[]): any[];
  function submit_img2img(...args: any[]): any[];
  function submit_enqueue(...args: any[]): any[];
  function submit_enqueue_img2img(...args: any[]): any[];
  function agent_scheduler_status_filter_changed(value: string): void;
  function appendContextMenuOption(selector: string, label: string, callback: () => void): void;
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
sharedStore.getSamplers().then((res) => {
  samplers.push(...res);
});
sharedStore.getCheckpoints().then((res) => {
  checkpoints.push(...res);
});

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
      valueGetter: ({ data }) => data?.name ?? data?.id,
      cellClass: ({ data }) => [
        'cursor-pointer',
        data?.status === 'pending' ? 'task-pending' : '',
        data?.status === 'running' ? 'task-running' : '',
        data?.status === 'done' ? 'task-done' : '',
        data?.status === 'failed' ? 'task-failed' : '',
        data?.status === 'interrupted' ? 'task-interrupted' : '',
      ],
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
          cellStyle: { 'line-height': '24px', 'padding-top': '8px', 'padding-bottom': '8px' },
        },
        {
          field: 'params.negative_prompt',
          headerName: 'Negative Prompt',
          cellDataType: 'text',
          minWidth: 200,
          maxWidth: 400,
          autoHeight: true,
          wrapText: true,
          cellStyle: { 'line-height': '24px', 'padding-top': '8px', 'padding-bottom': '8px' },
        },
        {
          field: 'params.checkpoint',
          headerName: 'Checkpoint',
          cellDataType: 'text',
          minWidth: 150,
          maxWidth: 300,
          valueFormatter: ({ value }) => value || 'System',
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: () => ({
            values: checkpoints,
          }),
        },
        {
          field: 'params.sampler_name',
          headerName: 'Sampler',
          cellDataType: 'text',
          width: 150,
          minWidth: 150,
          cellEditor: 'agSelectCellEditor',
          cellEditorParams: () => ({
            values: samplers,
          }),
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
          valueGetter: ({ data }) =>
            data?.params?.width ? `${data.params.width} × ${data.params.height}` : '',
        },
        {
          field: 'params.batch',
          headerName: 'Batching',
          minWidth: 100,
          maxWidth: 100,
          editable: false,
          valueGetter: ({ data }) =>
            data?.params?.n_iter ? `${data.params.batch_size} × ${data.params.n_iter}` : '1 × 1',
        },
      ],
    },
    {
      field: 'created_at',
      headerName: 'Queued At',
      minWidth: 170,
      editable: false,
      valueFormatter: ({ value }) => value && formatDate(new Date(value)),
    },
    {
      field: 'updated_at',
      headerName: 'Updated At',
      minWidth: 170,
      editable: false,
      valueFormatter: ({ value }) => value && formatDate(new Date(value)),
    },
  ],

  getRowId: ({ data }) => data.id,
  rowSelection: 'single', // allow rows to be selected
  animateRows: true, // have rows animate to new positions when sorted
  pagination: true,
  paginationAutoPageSize: true,
  suppressCopyRowsToClipboard: true,
  suppressRowTransform: true,
  enableBrowserTooltips: true,
};

function initSearchInput(selector: string) {
  const searchContainer = gradioApp().querySelector(selector);
  if (!searchContainer) {
    throw new Error(`search container ${selector} not found`);
  }

  searchContainer.className = 'ts-search';
  searchContainer.innerHTML = `
    <div class="ts-search-icon">
      ${searchIcon}
    </div>
    <input type="text" class="ts-search-input" placeholder="Search" required>
  `;

  return searchContainer;
}

async function notify(response: ResponseStatus) {
  if (!notyf) {
    const Notyf = await import('notyf');
    notyf = new Notyf.Notyf({
      position: {
        x: 'center',
        y: 'bottom',
      },
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
  const args = extractArgs(requestProgress);

  const gallery: HTMLDivElement = gradioApp().querySelector(
    '#agent_scheduler_current_task_images',
  )!;

  // A1111 version
  if (args.includes('progressbarContainer')) {
    requestProgress(task_id, gallery, gallery, callback);
  } else {
    // Vlad version
    const progressDiv = document.createElement('div');
    progressDiv.className = 'progressDiv';
    gallery.parentNode?.insertBefore(progressDiv, gallery);
    requestProgress(
      task_id,
      gallery,
      gallery,
      () => {
        gallery.parentNode?.removeChild(progressDiv);
        callback();
      },
      (res) => {
        if (!res) return;
        const perc = res ? `${Math.round((res?.progress || 0) * 100.0)}%` : '';
        const eta = res?.paused ? ' Paused' : ` ETA: ${Math.round(res?.eta || 0)}s`;
        progressDiv.innerText = `${perc}${eta}`;
        progressDiv.style.background = res
          ? `linear-gradient(to right, var(--primary-500) 0%, var(--primary-800) ${perc}, var(--neutral-700) ${perc})`
          : 'var(--button-primary-background-fill)';
      },
    );
  }

  // monkey patch randomId to return task_id, then call submit to trigger progress
  window.randomId = () => task_id;
  if (type === 'txt2img') {
    window.submit();
  } else if (type === 'img2img') {
    window.submit_img2img();
  }
  window.randomId = window.origRandomId;
}

function initQueueHandler() {
  const getUiCheckpoint = (is_img2img?: boolean) => {
    const enqueue_wrapper_id = is_img2img ? 'img2img_enqueue_wrapper' : 'txt2img_enqueue_wrapper';
    const enqueue_wrapper_model = gradioApp().querySelector<HTMLInputElement>(
      `#${enqueue_wrapper_id} input`,
    );
    if (enqueue_wrapper_model) {
      const checkpoint = enqueue_wrapper_model.value;
      if (checkpoint == 'Runtime Checkpoint') {
        return checkpoint;
      }
      if (checkpoint != 'Current Checkpoint') {
        return checkpoint;
      }
    }

    const setting_sd_model = gradioApp().querySelector<HTMLInputElement>(
      '#setting_sd_model_checkpoint input',
    );
    if (setting_sd_model) {
      return setting_sd_model.value;
    }

    return 'Current Checkpoint';
  };

  const btnEnqueue = document.querySelector<HTMLButtonElement>('#txt2img_enqueue');
  window.submit_enqueue = function submit_enqueue(...args) {
    const res = create_submit_args(args);
    res[0] = getUiCheckpoint();
    res[1] = randomId();
    window.randomId = window.origRandomId;

    if (btnEnqueue) {
      btnEnqueue.innerHTML = 'Queued';
      setTimeout(() => {
        btnEnqueue.innerHTML = 'Enqueue';
        if (!sharedStore.getState().uiAsTab) {
          if (sharedStore.getState().selectedTab === 'pending') {
            pendingStore.refresh();
          }
        }
      }, 1000);
    }

    return res;
  };

  const btnImg2ImgEnqueue = document.querySelector<HTMLButtonElement>('#img2img_enqueue');
  window.submit_enqueue_img2img = function submit_enqueue_img2img(...args) {
    const res = create_submit_args(args);
    res[0] = getUiCheckpoint(true);
    res[1] = randomId();
    res[2] = get_tab_index('mode_img2img');
    window.randomId = window.origRandomId;

    if (btnImg2ImgEnqueue) {
      btnImg2ImgEnqueue.innerHTML = 'Queued';
      setTimeout(() => {
        btnImg2ImgEnqueue.innerHTML = 'Enqueue';
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
  const interrogateCol: HTMLDivElement = gradioApp().querySelector('.interrogate-col')!;
  if (interrogateCol && interrogateCol.childElementCount > 2) {
    interrogateCol.classList.add('has-queue-button');
  }

  // setup keyboard shortcut
  const setting = gradioApp().querySelector(
    '#setting_queue_keyboard_shortcut textarea',
  ) as HTMLTextAreaElement;
  if (setting?.value && !setting.value.includes('Disabled')) {
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
        const btn = gradioApp().querySelector<HTMLButtonElement>('#txt2img_enqueue');
        btn?.click();
      } else if (activeTab === 1) {
        const btn = gradioApp().querySelector<HTMLButtonElement>('#img2img_enqueue');
        btn?.click();
      }
    };

    window.addEventListener('keydown', handleShortcut);

    const txt2imgPrompt = gradioApp().querySelector<HTMLTextAreaElement>(
      '#txt2img_prompt textarea',
    );
    if (txt2imgPrompt) {
      txt2imgPrompt.addEventListener('keydown', handleShortcut);
    }

    const img2imgPrompt = gradioApp().querySelector<HTMLTextAreaElement>(
      '#img2img_prompt textarea',
    );
    if (img2imgPrompt) {
      img2imgPrompt.addEventListener('keydown', handleShortcut);
    }
  }

  // watch for current task id change
  const onTaskIdChange = (id: string | null) => {
    if (!id) return;
    const task = pendingStore.getState().pending_tasks.find((t) => t.id === id);

    showTaskProgress(id, task?.type, pendingStore.refresh);
  };
  pendingStore.subscribe((curr, prev) => {
    if (prev.current_task_id !== curr.current_task_id) {
      onTaskIdChange(curr.current_task_id);
    }
  });

  // context menu
  const queueWithTaskName = (img2img = false) => {
    const name = prompt('Enter task name');
    window.randomId = () => name || window.origRandomId();
    if (img2img) {
      btnImg2ImgEnqueue?.click();
    } else {
      btnEnqueue?.click();
    }
  };
  const queueWithEveryCheckpoint = (img2img = false) => {
    window.randomId = () => '$$_queue_with_all_checkpoints_$$';
    if (img2img) {
      btnImg2ImgEnqueue?.click();
    } else {
      btnEnqueue?.click();
    }
  };

  appendContextMenuOption('#txt2img_enqueue', 'Queue with task name', () => queueWithTaskName());
  appendContextMenuOption('#txt2img_enqueue', 'Queue with all checkpoints', () =>
    queueWithEveryCheckpoint(),
  );
  appendContextMenuOption('#img2img_enqueue', 'Queue with task name', () =>
    queueWithTaskName(true),
  );
  appendContextMenuOption('#img2img_enqueue', 'Queue with all checkpoints', () =>
    queueWithEveryCheckpoint(true),
  );
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
  const observer = new MutationObserver(function (mutationsList) {
    mutationsList.forEach((styleChange) => {
      const tab = styleChange.target as HTMLElement;
      const visible = tab.style.display === 'block';
      if (!visible) return;

      if (tab.id === 'tab_agent_scheduler') {
        if (sharedStore.getState().selectedTab === 'pending') {
          pendingStore.refresh();
        } else {
          historyStore.refresh();
        }
      } else if (tab.id === 'agent_scheduler_pending_tasks_tab') {
        sharedStore.setSelectedTab('pending');
      } else if (tab.id === 'agent_scheduler_history_tab') {
        sharedStore.setSelectedTab('history');
      }
    });
  });
  if (document.getElementById('tab_agent_scheduler')) {
    observer.observe(document.getElementById('tab_agent_scheduler')!, {
      attributeFilter: ['style'],
    });
  } else {
    sharedStore.setState({ uiAsTab: false });
  }
  observer.observe(document.getElementById('agent_scheduler_pending_tasks_tab')!, {
    attributeFilter: ['style'],
  });
  observer.observe(document.getElementById('agent_scheduler_history_tab')!, {
    attributeFilter: ['style'],
  });
}

function initPendingTab() {
  const store = pendingStore;

  // init actions
  const refreshButton = gradioApp().querySelector('#agent_scheduler_action_reload')!;
  const pauseButton = gradioApp().querySelector('#agent_scheduler_action_pause')!;
  const resumeButton = gradioApp().querySelector('#agent_scheduler_action_resume')!;
  const clearButton = gradioApp().querySelector('#agent_scheduler_action_clear_queue')!;
  refreshButton.addEventListener('click', store.refresh);
  pauseButton.addEventListener('click', () => store.pauseQueue().then(notify));
  resumeButton.addEventListener('click', () => store.resumeQueue().then(notify));
  clearButton.addEventListener('click', () => {
    if (!confirm('Are you sure you want to clear the queue?')) return;
    store.clearQueue().then(notify);
  });

  // watch for queue status change
  store.subscribe((curr) => {
    if (curr.paused) {
      pauseButton.classList.add('hide', 'hidden');
      resumeButton.classList.remove('hide', 'hidden');
    } else {
      pauseButton.classList.remove('hide', 'hidden');
      resumeButton.classList.add('hide', 'hidden');
    }
  });

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
      ...(sharedGridOptions.columnDefs || []),
      {
        headerName: 'Action',
        pinned: 'right',
        minWidth: 110,
        maxWidth: 110,
        resizable: false,
        editable: false,
        valueGetter: ({ data }) => data?.id,
        cellClass: ({ data }) => (data?.editing ? 'pending-actions editing' : 'pending-actions'),
        cellRenderer: ({ api, value, data }: any) => {
          if (!data) return undefined;
          const html = `
            <div class="inline-flex rounded-md shadow-sm mt-1.5" role="group">
              <!-- editing -->
              <button type="button" title="Save" class="ts-btn-action ts-btn-success ts-btn-save">
                ${saveIcon}
              </button>
              <button type="button" title="Cancel"
                class="ts-btn-action ts-btn-warning ts-btn-cancel">
                ${cancelIcon}
              </button>
              
              <button type="button" title="Save" class="ts-btn-action ts-btn-success ts-btn-run"
                ${data.status === 'running' ? 'disabled' : ''}>
                ${playIcon}
              </button>
              <button type="button" title="${data.status === 'pending' ? 'Delete' : 'Interrupt'}"
                class="ts-btn-action ts-btn-danger ts-btn-delete">
                ${data.status === 'pending' ? deleteIcon : cancelIcon}
              </button>
            </div>
            `;

          const placeholder = document.createElement('div');
          placeholder.innerHTML = html;
          const node = placeholder.firstElementChild!;

          const btnSave = node.querySelector('button.ts-btn-save')!;
          btnSave.addEventListener('click', () => {
            api.showLoadingOverlay();
            pendingStore.updateTask(data.id, data).then((res) => {
              notify(res);
              api.hideOverlay();
              api.stopEditing(false);
            });
          });
          const btnCancel = node.querySelector('button.ts-btn-cancel')!;
          btnCancel.addEventListener('click', () => {
            api.stopEditing(true);
          });

          const btnRun = node.querySelector('button.ts-btn-run')!;
          btnRun.addEventListener('click', () => {
            api.showLoadingOverlay();
            store.runTask(value).then(() => api.hideOverlay());
          });

          const btnDelete = node.querySelector('button.ts-btn-delete')!;
          btnDelete.addEventListener('click', () => {
            api.showLoadingOverlay();
            store.deleteTask(value).then((res) => {
              notify(res);
              api.applyTransaction({
                remove: [data],
              });
              api.hideOverlay();
            });
          });

          return node;
        },
      },
    ],
    onColumnMoved({ columnApi }) {
      const colState = columnApi.getColumnState();
      const colStateStr = JSON.stringify(colState);
      localStorage.setItem('agent_scheduler:queue_col_state', colStateStr);
    },
    onSortChanged({ columnApi }) {
      const colState = columnApi.getColumnState();
      const colStateStr = JSON.stringify(colState);
      localStorage.setItem('agent_scheduler:queue_col_state', colStateStr);
    },
    onColumnResized({ columnApi }) {
      const colState = columnApi.getColumnState();
      const colStateStr = JSON.stringify(colState);
      localStorage.setItem('agent_scheduler:queue_col_state', colStateStr);
    },
    onGridReady: ({ api, columnApi }) => {
      // init quick search input
      const searchContainer = initSearchInput('#agent_scheduler_action_search');
      const searchInput: HTMLInputElement = searchContainer.querySelector('input.ts-search-input')!;
      searchInput.addEventListener(
        'keyup',
        debounce((e: KeyboardEvent) => {
          api.setQuickFilter((e.target as HTMLInputElement).value);
        }, 200),
      );

      store.subscribe((state) => {
        api.setRowData(state.pending_tasks);

        if (state.current_task_id) {
          const node = api.getRowNode(state.current_task_id);
          if (node) {
            api.refreshCells({ rowNodes: [node], force: true });
          }
        }

        columnApi.autoSizeAllColumns();
      });

      // restore col state
      const colStateStr = localStorage.getItem('agent_scheduler:queue_col_state');
      if (colStateStr) {
        const colState = JSON.parse(colStateStr);
        columnApi.applyColumnState({ state: colState, applyOrder: true });
      }
    },
    onRowDragEnd: ({ api, node, overNode }) => {
      const id = node.data?.id;
      const overId = overNode?.data?.id;
      if (id && overId && id !== overId) {
        api.showLoadingOverlay();
        store.moveTask(id, overId).then(() => api.hideOverlay());
      }
    },
    onRowEditingStarted: ({ api, data, node }) => {
      if (!data) return;
      node.setDataValue('editing', true);
      api.refreshCells({
        rowNodes: [node],
        force: true,
      });
    },
    onRowEditingStopped: ({ api, data, node }) => {
      if (!data) return;
      node.setDataValue('editing', false);
      api.refreshCells({
        rowNodes: [node],
        force: true,
      });
    },
    onRowValueChanged: ({ data, api }) => {
      if (!data) return;
      api.showLoadingOverlay();
      pendingStore.updateTask(data.id, data).then((res) => {
        notify(res);
        api.hideOverlay();
      });
    },
  };

  const eGridDiv = gradioApp().querySelector<HTMLDivElement>(
    '#agent_scheduler_pending_tasks_grid',
  )!;
  eGridDiv.style.height = 'calc(100vh - 300px)';
  new Grid(eGridDiv, gridOptions);
}

function initHistoryTab() {
  const store = historyStore;

  // init actions
  const refreshButton = gradioApp().querySelector('#agent_scheduler_action_refresh_history')!;
  const clearButton = gradioApp().querySelector('#agent_scheduler_action_clear_history')!;
  refreshButton.addEventListener('click', () => {
    store.refresh();
  });
  clearButton.addEventListener('click', () => {
    if (!confirm('Are you sure you want to clear the history?')) return;
    store.clearHistory().then(notify);
  });
  const resultTaskId: HTMLTextAreaElement = gradioApp().querySelector(
    '#agent_scheduler_history_selected_task textarea',
  )!;
  const resultImageId: HTMLTextAreaElement = gradioApp().querySelector(
    '#agent_scheduler_history_selected_image textarea',
  )!;
  const resultGallery: HTMLDivElement = gradioApp().querySelector(
    '#agent_scheduler_history_gallery',
  )!;

  resultGallery.addEventListener('click', (e) => {
    const target = e.target as HTMLImageElement;
    if (target.tagName === 'IMG') {
      const imageIdx = Array.prototype.indexOf.call(
        target.parentNode?.parentNode?.childNodes ?? [],
        target.parentNode,
      );
      resultImageId.value = imageIdx.toString();
      resultImageId.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  window.agent_scheduler_status_filter_changed = function (value) {
    store.onFilterStatus(value?.toLowerCase() as TaskStatus);
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
        cellClass: 'cursor-pointer pt-3',
        cellRenderer: ({ data, value }: any) => {
          if (!data) return undefined;
          return value
            ? `<span class="!text-yellow-400">${bookmarked}</span>`
            : `<span class="!text-gray-400">${bookmark}</span>`;
        },
        onCellClicked: ({ data, event, api }) => {
          if (!data) return;
          event?.stopPropagation();
          event?.preventDefault();
          store.bookmarkTask(data.id, !data.bookmarked).then((res) => {
            notify(res);
            api.applyTransaction({
              update: [{ ...data, bookmarked: !data.bookmarked }],
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
        ...(sharedGridOptions.columnDefs || [])[0],
        rowDrag: false,
      },
      ...(sharedGridOptions.columnDefs || []).slice(1),
      {
        headerName: 'Action',
        pinned: 'right',
        minWidth: 110,
        maxWidth: 110,
        resizable: false,
        valueGetter: ({ data }) => data?.id,
        cellRenderer: ({ api, data, value }: any) => {
          if (!data) return undefined;

          const html = `
            <div class="inline-flex rounded-md shadow-sm mt-1.5" role="group">
              <button type="button" title="Requeue" class="ts-btn-action ts-btn-success ts-btn-run">
                ${rotateIcon}
              </button>
              <button type="button" title="Delete" class="ts-btn-action ts-btn-danger ts-btn-delete">
                ${deleteIcon}
              </button>
            </div>
            `;

          const placeholder = document.createElement('div');
          placeholder.innerHTML = html;
          const node = placeholder.firstElementChild!;

          const btnRun = node.querySelector('button.ts-btn-run')!;
          btnRun.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            store.requeueTask(value).then((res) => {
              notify(res);
            });
          });

          const btnDelete = node.querySelector('button.ts-btn-delete')!;
          btnDelete.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            api.showLoadingOverlay();
            pendingStore.deleteTask(value).then((res) => {
              notify(res);
              api.applyTransaction({
                remove: [data],
              });
              api.hideOverlay();
            });
          });

          return node;
        },
      },
    ],
    rowSelection: 'single',
    suppressRowDeselection: true,
    onColumnMoved({ columnApi }) {
      const colState = columnApi.getColumnState();
      const colStateStr = JSON.stringify(colState);
      localStorage.setItem('agent_scheduler:history_col_state', colStateStr);
    },
    onSortChanged({ columnApi }) {
      const colState = columnApi.getColumnState();
      const colStateStr = JSON.stringify(colState);
      localStorage.setItem('agent_scheduler:history_col_state', colStateStr);
    },
    onColumnResized({ columnApi }) {
      const colState = columnApi.getColumnState();
      const colStateStr = JSON.stringify(colState);
      localStorage.setItem('agent_scheduler:history_col_state', colStateStr);
    },
    onGridReady: ({ api, columnApi }) => {
      // init quick search input
      const searchContainer = initSearchInput('#agent_scheduler_action_search_history');
      const searchInput: HTMLInputElement = searchContainer.querySelector('input.ts-search-input')!;
      searchInput.addEventListener(
        'keyup',
        debounce((e: KeyboardEvent) => {
          api.setQuickFilter((e.target as HTMLInputElement).value);
        }, 200),
      );

      store.subscribe((state) => {
        api.setRowData(state.tasks);
        columnApi.autoSizeAllColumns();
      });

      // restore col state
      const colStateStr = localStorage.getItem('agent_scheduler:history_col_state');
      if (colStateStr) {
        const colState = JSON.parse(colStateStr);
        columnApi.applyColumnState({ state: colState, applyOrder: true });
      }
    },
    onSelectionChanged: (e) => {
      const [selected] = e.api.getSelectedRows();
      if (selected) {
        resultTaskId.value = selected.id;
        resultTaskId.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    onCellEditRequest: ({ data, newValue, api, colDef }) => {
      if (colDef.field !== 'name') return;
      if (!newValue) return;

      api.showLoadingOverlay();
      historyStore.renameTask(data.id, newValue).then((res) => {
        notify(res);
        const newData = { ...data, name: newValue };
        const tx = {
          update: [newData],
        };
        api.applyTransaction(tx);
        api.hideOverlay();
      });
    },
  };
  const eGridDiv = gradioApp().querySelector<HTMLDivElement>(
    '#agent_scheduler_history_tasks_grid',
  )!;
  eGridDiv.style.height = 'calc(100vh - 300px)';
  new Grid(eGridDiv, gridOptions);
}

let agentSchedulerInitialized = false;

onUiLoaded(function initAgentScheduler() {
  // delay ui init until dom is available
  if (!document.getElementById('agent_scheduler_tabs')) {
    setTimeout(initAgentScheduler, 500);
    return;
  }
  if (agentSchedulerInitialized) return;
  initQueueHandler();
  initTabChangeHandler();
  initPendingTab();
  initHistoryTab();
  agentSchedulerInitialized = true;
});
